/**
 * Every translation bundled statically — for tests and the i18n checks only. The app loads the
 * active language on demand (`src/i18n.ts`), so this file is not part of the app bundle.
 */
import enCommon from './en/common.json';
import enAdmin from './en/admin.json';
import enProcesses from './en/processes.json';
import enModeler from './en/modeler.json';
import enObjects from './en/objects.json';
import enErrors from './en/errors.json';
import enDocs from './en/docs.json';
import enSearch from './en/search.json';
import enGovernance from './en/governance.json';
import enPortal from './en/portal.json';
import enAi from './en/ai.json';
import enGrc from './en/grc.json';
import enAssurance from './en/assurance.json';
import enEa from './en/ea.json';
import enKpi from './en/kpi.json';
import enDiagrams from './en/diagrams.json';
import enMining from './en/mining.json';
import enWorkflow from './en/workflow.json';
import enImports from './en/imports.json';
import enIntegrations from './en/integrations.json';
import arCommon from './ar/common.json';
import arAdmin from './ar/admin.json';
import arProcesses from './ar/processes.json';
import arModeler from './ar/modeler.json';
import arObjects from './ar/objects.json';
import arErrors from './ar/errors.json';
import arDocs from './ar/docs.json';
import arSearch from './ar/search.json';
import arGovernance from './ar/governance.json';
import arPortal from './ar/portal.json';
import arAi from './ar/ai.json';
import arGrc from './ar/grc.json';
import arAssurance from './ar/assurance.json';
import arEa from './ar/ea.json';
import arKpi from './ar/kpi.json';
import arDiagrams from './ar/diagrams.json';
import arMining from './ar/mining.json';
import arWorkflow from './ar/workflow.json';
import arImports from './ar/imports.json';
import arIntegrations from './ar/integrations.json';

export const resources = {
  en: {
    common: enCommon,
    admin: enAdmin,
    processes: enProcesses,
    modeler: enModeler,
    objects: enObjects,
    errors: enErrors,
    docs: enDocs,
    search: enSearch,
    governance: enGovernance,
    portal: enPortal,
    ai: enAi,
    grc: enGrc,
    assurance: enAssurance,
    ea: enEa,
    kpi: enKpi,
    diagrams: enDiagrams,
    mining: enMining,
    workflow: enWorkflow,
    imports: enImports,
    integrations: enIntegrations,
  },
  ar: {
    common: arCommon,
    admin: arAdmin,
    processes: arProcesses,
    modeler: arModeler,
    objects: arObjects,
    errors: arErrors,
    docs: arDocs,
    search: arSearch,
    governance: arGovernance,
    portal: arPortal,
    ai: arAi,
    grc: arGrc,
    assurance: arAssurance,
    ea: arEa,
    kpi: arKpi,
    diagrams: arDiagrams,
    mining: arMining,
    workflow: arWorkflow,
    imports: arImports,
    integrations: arIntegrations,
  },
} as const;

export const NAMESPACES = [
  'common',
  'admin',
  'processes',
  'modeler',
  'objects',
  'errors',
  'docs',
  'search',
  'governance',
  'portal',
  'ai',
  'grc',
  'assurance',
  'ea',
  'kpi',
  'diagrams',
  'mining',
  'workflow',
  'imports',
  'integrations',
] as const;
