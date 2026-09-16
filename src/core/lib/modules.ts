
import { moduleLoader } from './module-loader';
import { CORE_PERMISSIONS, CORE_PERMISSION_CATALOGUE } from './permission-names';
import { ModuleState, ModuleManifest } from './module-types';

/**
 * Module System for Blysis
 * 
 * Provides runtime module information populated by the file system loader.
 */

class ModuleSystem {
    private moduleStates: Map<string, ModuleState> = new Map();
    private initialized = false;

    /**
     * Get all module definitions directly from the loader
     */
    getDefinitions(): ModuleManifest[] {
        return moduleLoader.getModules().map(m => m.manifest);
    }

    /**
     * Get a specific module definition
     */
    getDefinition(id: string): ModuleManifest | undefined {
        return moduleLoader.getModule(id)?.manifest;
    }

    /**
     * Initialize module states from database
     */
    async initialize(states: ModuleState[]): Promise<void> {
        this.moduleStates.clear();
        for (const state of states) {
            this.moduleStates.set(state.id, state);
        }
        this.initialized = true;
    }

    /**
     * Check if a module is enabled
     */
    isEnabled(id: string): boolean {
        if (!this.initialized) return false;
        const state = this.moduleStates.get(id);
        // Module must exist in DB AND be enabled
        return state?.enabled === true;
    }

    /**
     * Get all enabled modules
     */
    getEnabledModules(): ModuleManifest[] {
        return this.getDefinitions().filter((m) => this.isEnabled(m.id));
    }

    /**
     * Every permission name an installed module offers, core's own first.
     *
     * Names only. What the roles screen shows is the label beside each, which
     * `permissionCatalogue()` carries because it also needs to know which
     * module a name belongs to and under which heading it sits.
     */
    getAllPermissions(): string[] {
        const permissions: string[] = [...CORE_PERMISSIONS];

        for (const mod of this.getEnabledModules()) {
            for (const entry of mod.permissions ?? []) {
                permissions.push(entry.name);
            }
        }

        return permissions;
    }

    /**
     * The vocabulary as a screen needs it: every name, the words a person
     * reads, and where those words live.
     *
     * A module's label resolves in that module's own translations, so core
     * carries no wording for a module and a fork that ships different ones
     * gets its own. Core's twelve sit in `messages-core` under sections,
     * because the panel itself is not a module.
     *
     * The enabled set is passed in rather than read from `isEnabled`. That
     * flag answers false until somebody calls `initialize()`, and in a route
     * handler nobody has: the screen would have shown core's twelve on an
     * installation running ninety modules, which is exactly what it did.
     */
    permissionCatalogue(enabled: Record<string, boolean>): PermissionEntry[] {
        const entries: PermissionEntry[] = CORE_PERMISSION_CATALOGUE.map((permission) => ({
            name: permission.name,
            labelKey: permission.labelKey,
            namespace: "core",
            section: permission.section,
        }));

        for (const mod of this.getDefinitions()) {
            // Absent means nobody has ruled on it, which the rest of the
            // product reads as enabled. A module explicitly turned off offers
            // nothing: its screens are 404 and a permission for them would be
            // a row an operator cannot act on.
            if (enabled[mod.id] === false) continue;
            for (const entry of mod.permissions ?? []) {
                entries.push({
                    name: entry.name,
                    labelKey: entry.labelKey,
                    namespace: mod.id,
                    section: mod.id,
                });
            }
        }

        return entries;
    }

}

/** One row of the roles screen: a name, its words, and where they live. */
export interface PermissionEntry {
    name: string;
    /** `namespace.key`, resolved against `namespace`'s own translations. */
    labelKey: string;
    /** `core`, or the module id whose translations carry the label. */
    namespace: string;
    /** The heading it sits under: one of core's four, or a module id. */
    section: string;
}

export const moduleSystem = new ModuleSystem();
export default moduleSystem;
