import { workflowDefinitionSchema } from '../../src/services/workflow-definition';
const step = { id: 'first', name: 'Deploy', type: 'action', config: { action: 'stack.deploy', resourceId: '11111111-1111-4111-8111-111111111111' } };
it('accepts configured sequential deployment and approval steps', () => {
  expect(workflowDefinitionSchema.safeParse({ steps: [step, { id: 'approve', name: 'Review', type: 'approval', config: {} }] }).success).toBe(true);
});
it('rejects empty, duplicate, unimplemented and unconfigured workflows', () => {
  for (const steps of [[], [step, step], [{ ...step, type: 'parallel' }], [{ ...step, config: { action: 'pretend-deploy' } }], [{ ...step, config: { action: 'stack.deploy' } }], [{ ...step, nextSteps: ['branch'] }]]) {
    expect(workflowDefinitionSchema.safeParse({ steps }).success).toBe(false);
  }
});
it('does not accept unimplemented schedule triggers', () => {
  expect(workflowDefinitionSchema.safeParse({ steps: [step], triggers: [{ type: 'cron', config: {} }] }).success).toBe(false);
});
