package panel

import (
	"errors"
	"fmt"
	"math/big"
	"strconv"
)

// Negative values are discounts: -0.5 bills 50%, -0.25 bills 75%.
// Thousandths and a persistent remainder keep small accounting polls exact.
func multiplierMilli(d Data) (int64, error) {
	v, exists := d["traffic_multiplier"]
	if !exists {
		return 1000, nil
	}
	r, ok := new(big.Rat).SetString(fmt.Sprint(v))
	if !ok || r.Cmp(big.NewRat(-1, 1)) < 0 || r.Cmp(big.NewRat(3, 1)) > 0 {
		return 0, errors.New("traffic multiplier must be between -1 and 3")
	}
	r.Mul(r, big.NewRat(1000, 1))
	if !r.IsInt() {
		return 0, errors.New("traffic multiplier supports at most three decimal places")
	}
	n := r.Num().Int64()
	if n < 0 {
		n += 1000
	}
	return n, nil
}

func trafficDefaults(c Data) Data {
	if _, ok := c["traffic_multiplier"]; !ok {
		c["traffic_multiplier"] = 1.0
	}
	if _, ok := c["raw_used_traffic_bytes"]; !ok {
		c["raw_used_traffic_bytes"] = num(c, "used_traffic_bytes")
	}
	if _, ok := c["raw_lifetime_traffic_bytes"]; !ok {
		c["raw_lifetime_traffic_bytes"] = num(c, "lifetime_traffic_bytes")
	}
	return c
}

func applyTrafficDelta(c Data, delta int64) error {
	trafficDefaults(c)
	rate, err := multiplierMilli(c)
	if err != nil || delta < 0 {
		return errors.New("invalid traffic multiplier or counter")
	}
	rem := num(c, "_charge_remainder")
	if rem < 0 || rem >= 1000 {
		return errors.New("invalid traffic remainder")
	}
	value := new(big.Int).Mul(big.NewInt(delta), big.NewInt(rate))
	value.Add(value, big.NewInt(rem))
	charged, remainder := new(big.Int), new(big.Int)
	charged.QuoRem(value, big.NewInt(1000), remainder)
	if !charged.IsInt64() {
		return errors.New("client traffic overflow")
	}
	for key, add := range map[string]int64{
		"used_traffic_bytes": charged.Int64(), "lifetime_traffic_bytes": charged.Int64(),
		"raw_used_traffic_bytes": delta, "raw_lifetime_traffic_bytes": delta,
	} {
		old := num(c, key)
		if old < 0 || add > int64(^uint64(0)>>1)-old {
			return errors.New("client traffic overflow")
		}
	}
	for _, key := range []string{"used_traffic_bytes", "lifetime_traffic_bytes"} {
		c[key] = num(c, key) + charged.Int64()
	}
	for _, key := range []string{"raw_used_traffic_bytes", "raw_lifetime_traffic_bytes"} {
		c[key] = num(c, key) + delta
	}
	c["_charge_remainder"] = remainder.Int64()
	c["last_traffic_at"] = stamp()
	return nil
}

var accountFields = []string{"enabled", "expires_at", "traffic_limit_bytes", "used_traffic_bytes", "lifetime_traffic_bytes", "raw_used_traffic_bytes", "raw_lifetime_traffic_bytes", "traffic_multiplier", "_charge_remainder", "last_traffic_at", "disabled_reason", "renewal_interval_days", "next_renewal_at"}

func accountKey(c Data) string {
	if id := num(c, "_account"); id > 0 {
		return "account:" + strconv.FormatInt(id, 10)
	}
	return "client:" + strconv.FormatInt(num(c, "id"), 10)
}

func resetTraffic(c Data) {
	c["used_traffic_bytes"], c["raw_used_traffic_bytes"], c["_charge_remainder"] = int64(0), int64(0), int64(0)
}
