//go:build ignore

// Example trellis flow. Run with: trellis run example
//
// Demonstrates the three building blocks of a flow:
//   - trellis.Open / ctx.Close: open a context and flush logs on exit
//   - ctx.Log:                  structured logging into the run journal
//   - ctx.WithSandbox + trellis.Run: a containerized sandbox with an OpenCode agent
//
// See https://github.com/kgonyon/trellis for the full library API.
package main

import (
	"log"

	"github.com/kgonyon/trellis/pkg/trellis"
)

func main() {
	// Open the trellis context. Always defer Close so flow logs are flushed.
	ctx, err := trellis.Open()
	if err != nil {
		log.Fatalf("trellis.Open: %v", err)
	}
	defer ctx.Close()

	ctx.Log.Notef("hello flow started run_id=%s", ctx.RunID)

	agent, err := trellis.NewOpenCodeAgent(trellis.OpenCodeAgentOpts{
		Name:                  "hello",
		PromptPath:            "example-prompt.md",
		SandboxCopyUserConfig: true,
	})
	if err != nil {
		log.Fatalf("NewOpenCodeAgent: %v", err)
	}

	err = ctx.WithSandbox(trellis.SandboxOpts{Name: "hello"},
		func(sb *trellis.Sandbox) error {
			res, runErr := trellis.Run(ctx, agent, trellis.RunOpts{Sandbox: sb})
			if runErr != nil {
				return runErr
			}
			ctx.Log.Notef("agent said: %s", res.FinalText)
			return nil
		})
	if err != nil {
		log.Fatalf("WithSandbox: %v", err)
	}
}
