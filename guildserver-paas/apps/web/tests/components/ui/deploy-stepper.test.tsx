import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "@jest/globals"
import { DeployStepper } from "../../../src/components/deploy-stepper"

describe("DeployStepper", () => {
  it("renders phase labels and timing information", () => {
    render(
      <DeployStepper
        phases={[
          {
            name: "validate",
            status: "completed",
            message: "Validating configuration",
            startedAt: "2026-08-12T07:00:00.000Z",
            completedAt: "2026-08-12T07:00:05.000Z",
          },
          {
            name: "build",
            status: "running",
            message: "Building image",
            startedAt: "2026-08-12T07:00:05.000Z",
          },
          {
            name: "health_check",
            status: "running",
            message: "Verifying container health and URL reachability",
            startedAt: "2026-08-12T07:00:12.000Z",
          },
        ]}
      />
    )

    expect(screen.getByText("Validate")).toBeInTheDocument()
    expect(screen.getByText("Build")).toBeInTheDocument()
    expect(screen.getByText("Verifying")).toBeInTheDocument()
    expect(screen.getByText(/Verifying container health/i)).toBeInTheDocument()
    expect(screen.getByText("5s")).toBeInTheDocument()
    expect(screen.getByText(/Started/i)).toBeInTheDocument()
  })
})
