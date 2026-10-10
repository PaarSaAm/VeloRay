package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/PaarSaAm/VeloRay/internal/agent"
	"github.com/PaarSaAm/VeloRay/internal/panel"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "version" {
		fmt.Println(panel.Version)
		return
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if len(os.Args) > 1 && os.Args[1] == "check-ports" {
		path := "/usr/local/etc/xray/config.json"
		if len(os.Args) > 2 {
			path = os.Args[2]
		}
		raw, err := os.ReadFile(path)
		if err == nil {
			var checks []agent.PortCheck
			checks, err = agent.InspectConfigPorts(ctx, agent.Commands{}, "xray.service", raw)
			if err == nil {
				err = json.NewEncoder(os.Stdout).Encode(map[string]any{"ports": checks})
			}
			if err == nil {
				err = agent.RequireFreePorts(checks)
			}
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "VeloRay:", err)
			os.Exit(1)
		}
		return
	}
	if err := agent.Serve(ctx, panel.Version); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
