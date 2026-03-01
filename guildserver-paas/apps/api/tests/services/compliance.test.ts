import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { complianceService } from '../../src/services/compliance';

describe('ComplianceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('framework management', () => {
    it('should return available compliance frameworks', async () => {
      const frameworks = await complianceService.getFrameworks();

      expect(frameworks).toHaveLength(3);
      expect(frameworks.map(f => f.id)).toContain('soc2');
      expect(frameworks.map(f => f.id)).toContain('hipaa');
      expect(frameworks.map(f => f.id)).toContain('pci-dss');

      frameworks.forEach(framework => {
        expect(framework).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          description: expect.any(String),
          version: expect.any(String),
          enabled: expect.any(Boolean),
          controls: expect.any(Array),
        });
      });
    });

    it('should get specific framework by ID', async () => {
      const soc2Framework = await complianceService.getFramework('soc2');

      expect(soc2Framework).toMatchObject({
        id: 'soc2',
        name: 'SOC 2 Type II',
        description: 'System and Organization Controls 2 Type II',
        version: '2017',
        enabled: true,
      });

      expect(soc2Framework?.controls).toHaveLength(5);
    });

    it('should return null for non-existent framework', async () => {
      const framework = await complianceService.getFramework('non-existent');
      expect(framework).toBeNull();
    });

    it('should enable framework', async () => {
      await complianceService.disableFramework('soc2', 'org-123');
      await complianceService.enableFramework('soc2', 'org-123');

      const framework = await complianceService.getFramework('soc2');
      expect(framework?.enabled).toBe(true);
    });
  });

  describe('compliance assessments', () => {
    it('should start new assessment', async () => {
      const assessment = await complianceService.startAssessment(
        'soc2',
        'org-123',
        'assessor@example.com'
      );

      expect(assessment).toMatchObject({
        frameworkId: 'soc2',
        organizationId: 'org-123',
        status: 'in_progress',
        score: 0,
        totalControls: 5,
        compliantControls: 0,
        nonCompliantControls: 0,
        partiallyCompliantControls: 0,
        notAssessedControls: 5,
        assessor: 'assessor@example.com',
      });
      expect(assessment.id).toBeDefined();
      expect(assessment.startedAt).toBeInstanceOf(Date);
    });

    it('should update control status and recalculate scores', async () => {
      const assessment = await complianceService.startAssessment(
        'soc2',
        'org-123',
        'assessor@example.com'
      );

      await complianceService.updateControlStatus(
        assessment.id,
        'soc2-cc1.1',
        'compliant',
        ['evidence1.pdf', 'evidence2.doc'],
        'Control implemented correctly'
      );

      const updatedAssessment = await complianceService.getAssessment(assessment.id);

      expect(updatedAssessment?.compliantControls).toBe(1);
      expect(updatedAssessment?.notAssessedControls).toBe(4);
      expect(updatedAssessment?.score).toBe(20); // 1/5 = 20%

      // Check control was updated
      const framework = await complianceService.getFramework('soc2');
      const control = framework?.controls.find(c => c.id === 'soc2-cc1.1');
      expect(control?.status).toBe('compliant');
      expect(control?.evidence).toEqual(['evidence1.pdf', 'evidence2.doc']);
      expect(control?.notes).toBe('Control implemented correctly');
      expect(control?.lastAssessed).toBeInstanceOf(Date);
    });

    it('should calculate score correctly with mixed statuses', async () => {
      const assessment = await complianceService.startAssessment(
        'soc2',
        'org-123',
        'assessor@example.com'
      );

      // Set 2 compliant, 1 partially compliant, 1 non-compliant, 1 not assessed
      await complianceService.updateControlStatus(assessment.id, 'soc2-cc1.1', 'compliant');
      await complianceService.updateControlStatus(assessment.id, 'soc2-cc2.1', 'compliant');
      await complianceService.updateControlStatus(assessment.id, 'soc2-cc3.1', 'partially_compliant');
      await complianceService.updateControlStatus(assessment.id, 'soc2-cc4.1', 'non_compliant');

      const updatedAssessment = await complianceService.getAssessment(assessment.id);

      expect(updatedAssessment?.compliantControls).toBe(2);
      expect(updatedAssessment?.partiallyCompliantControls).toBe(1);
      expect(updatedAssessment?.nonCompliantControls).toBe(1);
      expect(updatedAssessment?.notAssessedControls).toBe(1);
      
      // Score = (2 + 0.5 * 1) / 4 = 62.5%, rounded to 63%
      expect(updatedAssessment?.score).toBe(63);
    });

    it('should complete assessment when all controls assessed', async () => {
      const assessment = await complianceService.startAssessment(
        'hipaa',
        'org-123',
        'assessor@example.com'
      );

      const framework = await complianceService.getFramework('hipaa');
      const controlIds = framework!.controls.map(c => c.id);

      // Assess all controls
      for (const controlId of controlIds) {
        await complianceService.updateControlStatus(assessment.id, controlId, 'compliant');
      }

      const completedAssessment = await complianceService.completeAssessment(assessment.id);

      expect(completedAssessment.status).toBe('completed');
      expect(completedAssessment.completedAt).toBeInstanceOf(Date);
      expect(completedAssessment.score).toBe(100);
    });

    it('should not complete assessment with unassessed controls', async () => {
      const assessment = await complianceService.startAssessment(
        'soc2',
        'org-123',
        'assessor@example.com'
      );

      await expect(complianceService.completeAssessment(assessment.id))
        .rejects.toThrow('Cannot complete assessment with unassessed controls');
    });
  });

  describe('compliance reporting', () => {
    it('should generate compliance report', async () => {
      // Create and complete assessments
      const soc2Assessment = await complianceService.startAssessment(
        'soc2',
        'org-123',
        'assessor@example.com'
      );

      const soc2Framework = await complianceService.getFramework('soc2');
      for (const control of soc2Framework!.controls) {
        await complianceService.updateControlStatus(soc2Assessment.id, control.id, 'compliant');
      }
      await complianceService.completeAssessment(soc2Assessment.id);

      const report = await complianceService.generateComplianceReport(
        'org-123',
        ['soc2'],
        {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          end: new Date(),
        },
        'reporter@example.com'
      );

      expect(report).toMatchObject({
        organizationId: 'org-123',
        frameworkId: 'soc2',
        generatedBy: 'reporter@example.com',
      });

      expect(report.summary.overallScore).toBe(100);
      expect(report.summary.frameworks).toHaveLength(1);
      expect(report.summary.frameworks[0]).toMatchObject({
        name: 'SOC 2 Type II',
        score: 100,
        status: 'completed',
      });

      expect(report.summary.recommendations).toContain(
        'Schedule regular compliance reviews and continuous monitoring'
      );
      expect(report.details).toHaveLength(5); // SOC2 has 5 controls
    });

    it('should generate recommendations based on scores', async () => {
      const assessment = await complianceService.startAssessment(
        'pci-dss',
        'org-123',
        'assessor@example.com'
      );

      const framework = await complianceService.getFramework('pci-dss');
      const controls = framework!.controls;

      // Make half non-compliant (low score)
      for (let i = 0; i < controls.length; i++) {
        const status = i < controls.length / 2 ? 'non_compliant' : 'compliant';
        await complianceService.updateControlStatus(assessment.id, controls[i].id, status);
      }
      await complianceService.completeAssessment(assessment.id);

      const report = await complianceService.generateComplianceReport(
        'org-123',
        ['pci-dss'],
        {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          end: new Date(),
        },
        'reporter@example.com'
      );

      expect(report.summary.recommendations).toContain(
        'Immediate attention required for critical security controls'
      );
      expect(report.summary.recommendations).toContain(
        'Address all non-compliant controls with documented remediation plans'
      );
    });
  });

  describe('continuous monitoring', () => {
    it('should provide continuous monitoring data', async () => {
      const monitoring = await complianceService.getContinuousMonitoring('org-123');

      expect(monitoring).toMatchObject({
        frameworks: expect.any(Array),
        alerts: expect.any(Array),
      });

      expect(monitoring.frameworks).toHaveLength(3);
      monitoring.frameworks.forEach(framework => {
        expect(framework).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          score: expect.any(Number),
          status: expect.any(String),
          criticalIssues: expect.any(Number),
        });
      });

      monitoring.alerts.forEach(alert => {
        expect(alert).toMatchObject({
          id: expect.any(String),
          type: expect.stringMatching(/violation|risk|expiring/),
          title: expect.any(String),
          description: expect.any(String),
          severity: expect.stringMatching(/low|medium|high|critical/),
          createdAt: expect.any(Date),
        });
      });
    });
  });

  describe('error handling', () => {
    it('should handle non-existent framework in assessment', async () => {
      await expect(complianceService.startAssessment(
        'non-existent',
        'org-123',
        'assessor@example.com'
      )).rejects.toThrow('Framework not found');
    });

    it('should handle non-existent assessment', async () => {
      await expect(complianceService.updateControlStatus(
        'non-existent',
        'control-1',
        'compliant'
      )).rejects.toThrow('Assessment not found');
    });

    it('should handle non-existent control', async () => {
      const assessment = await complianceService.startAssessment(
        'soc2',
        'org-123',
        'assessor@example.com'
      );

      await expect(complianceService.updateControlStatus(
        assessment.id,
        'non-existent-control',
        'compliant'
      )).rejects.toThrow('Control not found');
    });
  });
});