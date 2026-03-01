import { logger } from "../utils/logger";

export interface ComplianceFramework {
  id: string;
  name: string;
  description: string;
  version: string;
  controls: ComplianceControl[];
  enabled: boolean;
}

export interface ComplianceControl {
  id: string;
  frameworkId: string;
  title: string;
  description: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "compliant" | "non_compliant" | "partially_compliant" | "not_assessed";
  evidence?: string[];
  lastAssessed?: Date;
  assessor?: string;
  notes?: string;
}

export interface ComplianceAssessment {
  id: string;
  frameworkId: string;
  organizationId: string;
  status: "in_progress" | "completed" | "failed";
  score: number; // 0-100
  totalControls: number;
  compliantControls: number;
  nonCompliantControls: number;
  partiallyCompliantControls: number;
  notAssessedControls: number;
  startedAt: Date;
  completedAt?: Date;
  assessor: string;
  report?: string;
}

export interface ComplianceReport {
  id: string;
  frameworkId: string;
  organizationId: string;
  title: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    overallScore: number;
    frameworks: {
      name: string;
      score: number;
      status: string;
    }[];
    recommendations: string[];
  };
  details: ComplianceControl[];
  generatedAt: Date;
  generatedBy: string;
}

class ComplianceService {
  private frameworks: Map<string, ComplianceFramework> = new Map();
  private assessments: Map<string, ComplianceAssessment> = new Map();

  constructor() {
    this.initializeFrameworks();
  }

  private initializeFrameworks() {
    // SOC 2 Framework
    const soc2Framework: ComplianceFramework = {
      id: "soc2",
      name: "SOC 2 Type II",
      description: "System and Organization Controls 2 Type II",
      version: "2017",
      enabled: true,
      controls: [
        {
          id: "soc2-cc1.1",
          frameworkId: "soc2",
          title: "Control Environment - Integrity and Ethical Values",
          description: "The entity demonstrates a commitment to integrity and ethical values",
          category: "Control Environment",
          severity: "high",
          status: "not_assessed",
        },
        {
          id: "soc2-cc2.1",
          frameworkId: "soc2",
          title: "Communication and Information - Internal Communication",
          description: "The entity obtains or generates and uses relevant, quality information to support the functioning of internal control",
          category: "Communication and Information",
          severity: "medium",
          status: "not_assessed",
        },
        {
          id: "soc2-cc3.1",
          frameworkId: "soc2",
          title: "Risk Assessment - Specifies Suitable Objectives",
          description: "The entity specifies objectives with sufficient clarity to enable the identification and assessment of risks relating to objectives",
          category: "Risk Assessment",
          severity: "high",
          status: "not_assessed",
        },
        {
          id: "soc2-cc4.1",
          frameworkId: "soc2",
          title: "Monitoring Activities - Conducts Ongoing Monitoring",
          description: "The entity selects, develops, and performs ongoing and/or separate evaluations to ascertain whether the components of internal control are present and functioning",
          category: "Monitoring Activities",
          severity: "medium",
          status: "not_assessed",
        },
        {
          id: "soc2-cc5.1",
          frameworkId: "soc2",
          title: "Control Activities - Selects and Develops Control Activities",
          description: "The entity selects and develops control activities that contribute to the mitigation of risks to the achievement of objectives to acceptable levels",
          category: "Control Activities",
          severity: "high",
          status: "not_assessed",
        },
      ],
    };

    // HIPAA Framework
    const hipaaFramework: ComplianceFramework = {
      id: "hipaa",
      name: "HIPAA",
      description: "Health Insurance Portability and Accountability Act",
      version: "2013",
      enabled: true,
      controls: [
        {
          id: "hipaa-164.306",
          frameworkId: "hipaa",
          title: "Security Standards - General Rules",
          description: "Covered entities must ensure the confidentiality, integrity, and availability of all ePHI",
          category: "Administrative Safeguards",
          severity: "critical",
          status: "not_assessed",
        },
        {
          id: "hipaa-164.308",
          frameworkId: "hipaa",
          title: "Administrative Safeguards",
          description: "Implement administrative actions and policies to manage security measures",
          category: "Administrative Safeguards",
          severity: "high",
          status: "not_assessed",
        },
        {
          id: "hipaa-164.310",
          frameworkId: "hipaa",
          title: "Physical Safeguards",
          description: "Implement physical measures to protect electronic systems and equipment",
          category: "Physical Safeguards",
          severity: "high",
          status: "not_assessed",
        },
        {
          id: "hipaa-164.312",
          frameworkId: "hipaa",
          title: "Technical Safeguards",
          description: "Implement technical measures to protect and control access to ePHI",
          category: "Technical Safeguards",
          severity: "critical",
          status: "not_assessed",
        },
      ],
    };

    // PCI DSS Framework
    const pciFramework: ComplianceFramework = {
      id: "pci-dss",
      name: "PCI DSS",
      description: "Payment Card Industry Data Security Standard",
      version: "4.0",
      enabled: true,
      controls: [
        {
          id: "pci-1",
          frameworkId: "pci-dss",
          title: "Install and maintain network security controls",
          description: "Install and maintain network security controls to protect the cardholder data environment",
          category: "Network Security",
          severity: "critical",
          status: "not_assessed",
        },
        {
          id: "pci-2",
          frameworkId: "pci-dss",
          title: "Apply secure configurations to all system components",
          description: "Apply secure configurations to all system components",
          category: "System Configuration",
          severity: "high",
          status: "not_assessed",
        },
        {
          id: "pci-3",
          frameworkId: "pci-dss",
          title: "Protect stored cardholder data",
          description: "Protect stored cardholder data",
          category: "Data Protection",
          severity: "critical",
          status: "not_assessed",
        },
        {
          id: "pci-4",
          frameworkId: "pci-dss",
          title: "Protect cardholder data with strong cryptography during transmission",
          description: "Protect cardholder data with strong cryptography during transmission over open, public networks",
          category: "Data Protection",
          severity: "critical",
          status: "not_assessed",
        },
      ],
    };

    this.frameworks.set("soc2", soc2Framework);
    this.frameworks.set("hipaa", hipaaFramework);
    this.frameworks.set("pci-dss", pciFramework);
  }

  async getFrameworks(): Promise<ComplianceFramework[]> {
    return Array.from(this.frameworks.values());
  }

  async getFramework(frameworkId: string): Promise<ComplianceFramework | null> {
    return this.frameworks.get(frameworkId) || null;
  }

  async enableFramework(frameworkId: string, organizationId: string): Promise<void> {
    const framework = this.frameworks.get(frameworkId);
    if (!framework) {
      throw new Error("Framework not found");
    }

    framework.enabled = true;
    logger.info("Compliance framework enabled", { frameworkId, organizationId });
  }

  async disableFramework(frameworkId: string, organizationId: string): Promise<void> {
    const framework = this.frameworks.get(frameworkId);
    if (!framework) {
      throw new Error("Framework not found");
    }

    framework.enabled = false;
    logger.info("Compliance framework disabled", { frameworkId, organizationId });
  }

  async startAssessment(
    frameworkId: string,
    organizationId: string,
    assessor: string
  ): Promise<ComplianceAssessment> {
    const framework = this.frameworks.get(frameworkId);
    if (!framework) {
      throw new Error("Framework not found");
    }

    const assessment: ComplianceAssessment = {
      id: `assessment-${Date.now()}`,
      frameworkId,
      organizationId,
      status: "in_progress",
      score: 0,
      totalControls: framework.controls.length,
      compliantControls: 0,
      nonCompliantControls: 0,
      partiallyCompliantControls: 0,
      notAssessedControls: framework.controls.length,
      startedAt: new Date(),
      assessor,
    };

    this.assessments.set(assessment.id, assessment);
    logger.info("Compliance assessment started", { assessmentId: assessment.id, frameworkId, organizationId });

    return assessment;
  }

  async updateControlStatus(
    assessmentId: string,
    controlId: string,
    status: ComplianceControl["status"],
    evidence?: string[],
    notes?: string
  ): Promise<void> {
    const assessment = this.assessments.get(assessmentId);
    if (!assessment) {
      throw new Error("Assessment not found");
    }

    const framework = this.frameworks.get(assessment.frameworkId);
    if (!framework) {
      throw new Error("Framework not found");
    }

    const control = framework.controls.find(c => c.id === controlId);
    if (!control) {
      throw new Error("Control not found");
    }

    const oldStatus = control.status;
    control.status = status;
    control.evidence = evidence;
    control.notes = notes;
    control.lastAssessed = new Date();
    control.assessor = assessment.assessor;

    // Update assessment counts
    this.updateAssessmentCounts(assessment, oldStatus, status);

    logger.info("Control status updated", { assessmentId, controlId, status });
  }

  private updateAssessmentCounts(
    assessment: ComplianceAssessment,
    oldStatus: ComplianceControl["status"],
    newStatus: ComplianceControl["status"]
  ) {
    // Decrement old status count
    switch (oldStatus) {
      case "compliant":
        assessment.compliantControls--;
        break;
      case "non_compliant":
        assessment.nonCompliantControls--;
        break;
      case "partially_compliant":
        assessment.partiallyCompliantControls--;
        break;
      case "not_assessed":
        assessment.notAssessedControls--;
        break;
    }

    // Increment new status count
    switch (newStatus) {
      case "compliant":
        assessment.compliantControls++;
        break;
      case "non_compliant":
        assessment.nonCompliantControls++;
        break;
      case "partially_compliant":
        assessment.partiallyCompliantControls++;
        break;
      case "not_assessed":
        assessment.notAssessedControls++;
        break;
    }

    // Calculate score
    const assessedControls = assessment.totalControls - assessment.notAssessedControls;
    if (assessedControls > 0) {
      assessment.score = Math.round(
        ((assessment.compliantControls + assessment.partiallyCompliantControls * 0.5) / assessedControls) * 100
      );
    }
  }

  async completeAssessment(assessmentId: string): Promise<ComplianceAssessment> {
    const assessment = this.assessments.get(assessmentId);
    if (!assessment) {
      throw new Error("Assessment not found");
    }

    if (assessment.notAssessedControls > 0) {
      throw new Error("Cannot complete assessment with unassessed controls");
    }

    assessment.status = "completed";
    assessment.completedAt = new Date();

    logger.info("Compliance assessment completed", { assessmentId, score: assessment.score });

    return assessment;
  }

  async getAssessments(organizationId: string): Promise<ComplianceAssessment[]> {
    return Array.from(this.assessments.values()).filter(
      assessment => assessment.organizationId === organizationId
    );
  }

  async getAssessment(assessmentId: string): Promise<ComplianceAssessment | null> {
    return this.assessments.get(assessmentId) || null;
  }

  async generateComplianceReport(
    organizationId: string,
    frameworkIds: string[],
    period: { start: Date; end: Date },
    generatedBy: string
  ): Promise<ComplianceReport> {
    const relevantAssessments = Array.from(this.assessments.values()).filter(
      assessment => 
        assessment.organizationId === organizationId &&
        frameworkIds.includes(assessment.frameworkId) &&
        assessment.completedAt &&
        assessment.completedAt >= period.start &&
        assessment.completedAt <= period.end
    );

    const frameworkSummaries = frameworkIds.map(frameworkId => {
      const framework = this.frameworks.get(frameworkId);
      const latestAssessment = relevantAssessments
        .filter(a => a.frameworkId === frameworkId)
        .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0))[0];

      return {
        name: framework?.name || frameworkId,
        score: latestAssessment?.score || 0,
        status: latestAssessment?.status || "not_assessed",
      };
    });

    const overallScore = frameworkSummaries.reduce((sum, f) => sum + f.score, 0) / frameworkSummaries.length || 0;

    const recommendations = this.generateRecommendations(relevantAssessments);

    const allControls = frameworkIds.flatMap(frameworkId => {
      const framework = this.frameworks.get(frameworkId);
      return framework?.controls || [];
    });

    const report: ComplianceReport = {
      id: `report-${Date.now()}`,
      frameworkId: frameworkIds.join(","),
      organizationId,
      title: `Compliance Report - ${period.start.toDateString()} to ${period.end.toDateString()}`,
      period,
      summary: {
        overallScore: Math.round(overallScore),
        frameworks: frameworkSummaries,
        recommendations,
      },
      details: allControls,
      generatedAt: new Date(),
      generatedBy,
    };

    logger.info("Compliance report generated", { reportId: report.id, organizationId, frameworks: frameworkIds });

    return report;
  }

  private generateRecommendations(assessments: ComplianceAssessment[]): string[] {
    const recommendations: string[] = [];

    const avgScore = assessments.reduce((sum, a) => sum + a.score, 0) / assessments.length || 0;

    if (avgScore < 70) {
      recommendations.push("Consider implementing a comprehensive compliance program with regular assessments");
    }

    if (avgScore < 50) {
      recommendations.push("Immediate attention required for critical security controls");
    }

    const hasNonCompliant = assessments.some(a => a.nonCompliantControls > 0);
    if (hasNonCompliant) {
      recommendations.push("Address all non-compliant controls with documented remediation plans");
    }

    recommendations.push("Schedule regular compliance reviews and continuous monitoring");
    recommendations.push("Provide compliance training to relevant team members");

    return recommendations;
  }

  async getContinuousMonitoring(organizationId: string): Promise<{
    frameworks: {
      id: string;
      name: string;
      score: number;
      status: string;
      lastAssessed: Date | null;
      criticalIssues: number;
    }[];
    alerts: {
      id: string;
      type: "violation" | "risk" | "expiring";
      title: string;
      description: string;
      severity: "low" | "medium" | "high" | "critical";
      createdAt: Date;
    }[];
  }> {
    const frameworks = Array.from(this.frameworks.values()).map(framework => {
      const latestAssessment = Array.from(this.assessments.values())
        .filter(a => a.organizationId === organizationId && a.frameworkId === framework.id)
        .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0))[0];

      const criticalIssues = framework.controls.filter(
        c => c.severity === "critical" && (c.status === "non_compliant" || c.status === "not_assessed")
      ).length;

      return {
        id: framework.id,
        name: framework.name,
        score: latestAssessment?.score || 0,
        status: latestAssessment?.status || "not_assessed",
        lastAssessed: latestAssessment?.completedAt || null,
        criticalIssues,
      };
    });

    // Mock alerts for demonstration
    const alerts = [
      {
        id: "alert-1",
        type: "violation" as const,
        title: "Encryption Key Rotation Overdue",
        description: "Database encryption keys have not been rotated in 90+ days",
        severity: "high" as const,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        id: "alert-2",
        type: "risk" as const,
        title: "Privileged Access Review Required",
        description: "Annual privileged access review is due this month",
        severity: "medium" as const,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ];

    return { frameworks, alerts };
  }
}

export const complianceService = new ComplianceService();