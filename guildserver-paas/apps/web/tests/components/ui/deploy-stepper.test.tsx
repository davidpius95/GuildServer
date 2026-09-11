import { render, screen } from "@testing-library/react"
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

    // The stepper renders two parallel layouts — a horizontal one for
    // desktop and a vertical one for mobile — toggled with responsive
    // Tailwind classes (`hidden sm:flex` / `sm:hidden`). jsdom doesn't
    // evaluate media queries, so both layouts are present in the DOM at
    // once and every label/value appears twice. Assert with getAllByText
    // instead of getByText to account for that duplication.
    expect(screen.getAllByText("Validate").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Build").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Verifying").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Verifying container health/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText("5s").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Started/i).length).toBeGreaterThan(0)
  })
})
