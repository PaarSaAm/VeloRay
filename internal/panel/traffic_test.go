package panel

import (
	"encoding/json"
	"testing"
)

func TestTrafficMultiplierAndFractionalPolling(t *testing.T) {
	for _, tc := range []struct {
		factor string
		billed int64
	}{{"-0.5", 500}, {"-0.25", 750}, {"-1", 0}, {"0", 0}, {"1", 1000}, {"2.345", 2345}, {"3", 3000}} {
		t.Run(tc.factor, func(t *testing.T) {
			c := defaults("clients")
			c["traffic_multiplier"] = json.Number(tc.factor)
			for i := 0; i < 1000; i++ {
				if e := applyTrafficDelta(c, 1); e != nil {
					t.Fatal(e)
				}
			}
			if num(c, "used_traffic_bytes") != tc.billed || num(c, "raw_used_traffic_bytes") != 1000 || num(c, "_charge_remainder") != 0 {
				t.Fatal("fractional polling changed the bill")
			}
			resetTraffic(c)
			if num(c, "used_traffic_bytes") != 0 || num(c, "raw_used_traffic_bytes") != 0 || num(c, "lifetime_traffic_bytes") != tc.billed || num(c, "raw_lifetime_traffic_bytes") != 1000 {
				t.Fatal("reset lost lifetime counters")
			}
		})
	}
}
func TestInvalidMultipliersAndOverflow(t *testing.T) {
	for _, factor := range []string{"3.001", "-1.001", "NaN", "Infinity", "1.0001", "abc"} {
		if _, e := multiplierMilli(Data{"traffic_multiplier": json.Number(factor)}); e == nil {
			t.Fatalf("accepted invalid multiplier %s", factor)
		}
	}
	c := defaults("clients")
	c["used_traffic_bytes"] = int64(^uint64(0) >> 1)
	before := clone(c)
	if e := applyTrafficDelta(c, 1); e == nil {
		t.Fatal("accepted overflowing traffic")
	}
	if num(c, "raw_used_traffic_bytes") != num(before, "raw_used_traffic_bytes") {
		t.Fatal("overflow partially mutated traffic")
	}
	old := Data{"used_traffic_bytes": int64(123), "lifetime_traffic_bytes": int64(456)}
	trafficDefaults(old)
	if num(old, "raw_used_traffic_bytes") != 123 || num(old, "raw_lifetime_traffic_bytes") != 456 {
		t.Fatal("old account counters changed")
	}
}
