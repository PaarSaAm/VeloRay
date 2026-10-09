package panel

import (
	"context"
	"golang.org/x/sys/unix"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

var cpuMu sync.Mutex
var cpuPrevTotal, cpuPrevIdle float64

func readCPU() (float64, float64) {
	raw, _ := os.ReadFile("/proc/stat")
	line := strings.SplitN(string(raw), "\n", 2)[0]
	f := strings.Fields(line)
	var total, idle float64
	if len(f) < 2 {
		return 0, 0
	}
	for i, v := range f[1:] {
		n, _ := strconv.ParseFloat(v, 64)
		if i < 8 {
			total += n
		}
		if i == 3 || i == 4 {
			idle += n
		}
	}
	return total, idle
}
func hostMetrics() Data {
	host, _ := os.Hostname()
	d := Data{"hostname": host, "platform": runtime.GOOS + "/" + runtime.GOARCH, "go_version": runtime.Version(), "uptime_seconds": 0, "load_average": []float64{0, 0, 0}, "cpu_count": runtime.NumCPU(), "cpu_percent": float64(0)}
	raw, _ := os.ReadFile("/proc/uptime")
	if f := strings.Fields(string(raw)); len(f) > 0 {
		v, _ := strconv.ParseFloat(f[0], 64)
		d["uptime_seconds"] = int64(v)
	}
	raw, _ = os.ReadFile("/proc/loadavg")
	f := strings.Fields(string(raw))
	if len(f) >= 3 {
		values := []float64{}
		for _, s := range f[:3] {
			v, _ := strconv.ParseFloat(s, 64)
			values = append(values, v)
		}
		d["load_average"] = values
	}
	mem := map[string]int64{}
	raw, _ = os.ReadFile("/proc/meminfo")
	for _, line := range strings.Split(string(raw), "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 {
			n, _ := strconv.ParseInt(f[1], 10, 64)
			mem[strings.TrimSuffix(f[0], ":")] = n * 1024
		}
	}
	total, available := mem["MemTotal"], mem["MemAvailable"]
	swap, free := mem["SwapTotal"], mem["SwapFree"]
	d["memory_total_bytes"] = total
	d["memory_available_bytes"] = available
	d["memory_used_bytes"] = max(0, total-available)
	d["memory_percent"] = percent(total-available, total)
	d["swap_total_bytes"] = swap
	d["swap_free_bytes"] = free
	d["swap_used_bytes"] = max(0, swap-free)
	d["swap_percent"] = percent(swap-free, swap)
	var st unix.Statfs_t
	if unix.Statfs("/", &st) == nil {
		total := int64(st.Blocks) * st.Bsize
		free := int64(st.Bavail) * st.Bsize
		d["disk_total_bytes"] = total
		d["disk_free_bytes"] = free
		d["disk_used_bytes"] = total - free
		d["disk_percent"] = percent(total-free, total)
	}
	cpuMu.Lock()
	t, i := readCPU()
	if cpuPrevTotal > 0 && t > cpuPrevTotal {
		d["cpu_percent"] = max(0, min(100, (1-(i-cpuPrevIdle)/(t-cpuPrevTotal))*100))
	}
	cpuPrevTotal, cpuPrevIdle = t, i
	cpuMu.Unlock()
	return d
}
func percent(a, b int64) float64 {
	if b <= 0 {
		return 0
	}
	return float64(a) / float64(b) * 100
}
func (s *Server) systemInfo(ctx context.Context) (Data, error) {
	d := hostMetrics()
	var users, admins int
	if e := s.Store.Pool.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE data->>'is_active'='true' AND data->>'is_superuser'='true') FROM vr_users`).Scan(&users, &admins); e != nil {
		return nil, e
	}
	d["users_total"] = users
	d["admins_total"] = admins
	d["panel_version"] = Version
	d["server_time"] = stamp(time.Now())
	return d, nil
}
