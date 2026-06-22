/**
 * Load embedded chart schemas for the wizard's schema-driven form.
 * Schemas are bundled at build time from the Helm chart repo.
 */

// Version 0.1.0 schemas
import aaq from '../schemas/0.1.0/aaq.json';
import butaneOperator from '../schemas/0.1.0/butane-operator.json';
import cdi from '../schemas/0.1.0/cdi.json';
import cloudProvider from '../schemas/0.1.0/cloud-provider-kubevirt.json';
import deleteProtection from '../schemas/0.1.0/delete-protection.json';
import forklift from '../schemas/0.1.0/forklift.json';
import global from '../schemas/0.1.0/global.json';
import hostpathProvisioner from '../schemas/0.1.0/hostpath-provisioner.json';
import ipamController from '../schemas/0.1.0/ipam-controller.json';
import kubemacpool from '../schemas/0.1.0/kubemacpool.json';
import kubevirt from '../schemas/0.1.0/kubevirt.json';
import monitoring from '../schemas/0.1.0/monitoring.json';
import multus from '../schemas/0.1.0/multus.json';
import vmConsoleProxy from '../schemas/0.1.0/vm-console-proxy.json';
import vmTemplates from '../schemas/0.1.0/vm-templates.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonSchema = Record<string, any>;

const SCHEMAS: Record<string, Record<string, JsonSchema>> = {
  '0.1.0': {
    global,
    kubevirt,
    cdi,
    multus,
    kubemacpool,
    aaq,
    butaneOperator: butaneOperator,
    vmConsoleProxy: vmConsoleProxy,
    hostpathProvisioner: hostpathProvisioner,
    forklift,
    cloudProvider: cloudProvider,
    ipamController: ipamController,
    monitoring,
    deleteProtection: deleteProtection,
    vmTemplates: vmTemplates,
  },
};

const LATEST_VERSION = '0.1.0';

/** Get the global chart schema for a given version */
export function getGlobalSchema(version?: string): JsonSchema | null {
  const v = version && SCHEMAS[version] ? version : LATEST_VERSION;
  return SCHEMAS[v]?.global || null;
}

/** Get the schema for a specific operator/subchart */
export function getOperatorSchema(operatorId: string, version?: string): JsonSchema | null {
  const v = version && SCHEMAS[version] ? version : LATEST_VERSION;
  return SCHEMAS[v]?.[operatorId] || null;
}

/** Get all available schema versions */
export function getSchemaVersions(): string[] {
  return Object.keys(SCHEMAS);
}
