import { runtimeSettingsSchema, resolveRuntimePort, appStorageMount } from '../../src/services/app-runtime';
it.each(['/','/app','/etc','/var/run/docker.sock','/app/../etc','relative','/proc/data'])('rejects unsafe mount path %s', path => {
 expect(runtimeSettingsSchema.safeParse({persistentStoragePath:path}).success).toBe(false);
});
it('keeps storage identity across deployments and separates preview data', () => {
 expect(appStorageMount('abc','/app/data')).toEqual({Type:'volume',Source:'gs-app-abc-data',Target:'/app/data'});
 expect(appStorageMount('abc','/app/data','preview-42').Source).not.toBe('gs-app-abc-data');
});
it('accepts a dedicated data directory and optional port', () => {
 expect(runtimeSettingsSchema.parse({persistentStoragePath:'/app/data',containerPort:3000})).toMatchObject({containerPort:3000});
});
it.each([0,65536,1.5])('rejects invalid port %s', port => {
 expect(runtimeSettingsSchema.safeParse({containerPort:port}).success).toBe(false);
});
it('uses explicit port before environment, then image configuration', () => {
 expect(resolveRuntimePort(8080,'3000',80)).toBe(8080);
 expect(resolveRuntimePort(undefined,'3000',80)).toBe(3000);
 expect(resolveRuntimePort(undefined,undefined,8000)).toBe(8000);
});
