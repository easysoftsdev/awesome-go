package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

const appVersion = "1.0.0"

func main() {
	app := application.New(application.Options{
		Name:        "Offline POS",
		Description: "Offline-first point of sale with setup wizard",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Services: []application.Service{
			application.NewService(&SetupService{}),
			application.NewService(&PosService{}),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	appInstance = app

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:              "main",
		Title:             "Offline POS",
		Width:             1180,
		Height:            760,
		MinWidth:          940,
		MinHeight:         620,
		BackgroundColour:  application.NewRGB(243, 244, 246),
		URL:               "/",
	})

	if (&SetupService{}).IsConfigured() {
		go func() {
			store, err := openStoreIfNeeded()
			if err != nil {
				log.Printf("store warmup failed: %v", err)
				return
			}
			if _, err := store.EnsureSeedData(); err != nil {
				log.Printf("catalog seed failed: %v", err)
			}
		}()
	}
	go startSyncLoop()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
