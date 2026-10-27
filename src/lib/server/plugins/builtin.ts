import { docket } from '../../plugins/docket/plugin.server';
import { improve } from '../../plugins/improve/plugin.server';
import type { WheelhousePlugin } from './types';

/** The plugins compiled into this Wheelhouse, in the order their entries tie-break. */
export const BUILTIN_PLUGINS: WheelhousePlugin[] = [docket, improve];
