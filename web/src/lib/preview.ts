import { Me } from './api';

/** Admin "see the app as…" (D-111): overrides only the flags that decide what a role sees, so Admin can walk every
 *  designation's layout and menu. Data still loads with the Admin's own permissions (no impersonation, no data leak);
 *  it is a layout/experience preview, clearly labelled. */
export type PersonaKey = 'executive' | 'bm' | 'zm' | 'collections' | 'ba' | 'hr' | 'leadership';

type Over = Partial<Me> & { designation: string };
const P: Record<PersonaKey, { label: string; over: Over }> = {
  executive: { label: 'Operations Executive', over: { designation: 'Executive', roles: ['executive'], manages_operations: false, manages_collections: false, ops_blind: false, hr: false, leadership: false, reports_figures: true, resource_type: 'own_employee', heads_locations: false } },
  bm: { label: 'Branch Manager', over: { designation: 'Branch Manager', roles: ['bm'], manages_operations: true, manages_collections: false, ops_blind: false, hr: false, leadership: false, reports_figures: true, heads_locations: true } },
  zm: { label: 'Zonal Manager', over: { designation: 'Zonal Manager', roles: ['zm'], manages_operations: true, manages_collections: false, ops_blind: false, hr: false, leadership: false, reports_figures: true, heads_locations: true } },
  collections: { label: 'Collections (location head)', over: { designation: 'Collections Head', roles: ['collections_head'], manages_operations: false, manages_collections: true, ops_blind: true, hr: false, leadership: false, reports_figures: true, heads_locations: true } },
  ba: { label: 'Business Associate (partner)', over: { designation: 'Business Associate', roles: ['ba'], manages_operations: true, manages_collections: false, ops_blind: false, hr: false, leadership: false, reports_figures: true, resource_type: 'partner', heads_locations: true } },
  hr: { label: 'HR', over: { designation: 'HR', roles: ['hr_admin'], manages_operations: false, manages_collections: false, ops_blind: false, hr: true, leadership: false, reports_figures: false, heads_locations: false } },
  leadership: { label: 'Leadership', over: { designation: 'Leadership', roles: ['leadership'], manages_operations: false, manages_collections: false, ops_blind: false, hr: false, leadership: true, reports_figures: false, heads_locations: false } },
};

export const PERSONAS: { key: PersonaKey; label: string }[] = (Object.keys(P) as PersonaKey[]).map((k) => ({ key: k, label: P[k].label }));
export const personaLabel = (k: PersonaKey) => P[k].label;
/** The real admin me, re-flagged to the chosen persona. Identity (person_id, name, company) is kept. */
export const applyPersona = (me: Me, key: PersonaKey): Me => ({ ...me, ...P[key].over });
