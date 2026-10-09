package main

import (
	"context"
	"errors"
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
		log.Print(panel.Version)
		return
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := agent.Serve(ctx, panel.Version); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
