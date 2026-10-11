import { docket } from '../../plugins/docket/plugin.server';
import { projectLinks } from '../../plugins/project-links/plugin.server';
import type { WheelhousePlugin } from './types';

/** The plugins compiled into this Wheelhouse, in the order their entries tie-break. */
export const BUILTIN_PLUGINS: WheelhousePlugin[] = [projectLinks, docket];
