/**
 * QuantumShield - useIdentity Hook
 *
 * Provides identity state to the entire app.
 * Loads from localStorage on mount, exposes create/import/export/update actions.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  type QSIdentity,
  generateIdentity,
  loadIdentity,
  saveIdentity,
  deleteIdentity,
  updateAlias,
  exportIdentityJSON,
  importIdentityJSON,
} from '@/services/IdentityService';

export type IdentityStatus = 'loading' | 'none' | 'ready';

export function useIdentity() {
  const [identity, setIdentity] = useState<QSIdentity | null>(null);
  const [status, setStatus] = useState<IdentityStatus>('loading');

  // Load on mount
  useEffect(() => {
    let active = true;
    loadIdentity().then(stored => {
      if (active) {
        setIdentity(stored);
        setStatus(stored ? 'ready' : 'none');
      }
    });
    return () => { active = false; };
  }, []);

  const create = useCallback(async (alias?: string) => {
    const id = await generateIdentity(alias);
    setIdentity(id);
    setStatus('ready');
    return id;
  }, []);

  const setAlias = useCallback((alias: string) => {
    setIdentity(prev => {
      if (!prev) return prev;
      updateAlias(prev, alias).then(updated => {
        setIdentity(updated);
      });
      return { ...prev, alias: alias.trim() };
    });
  }, []);

  const exportJSON = useCallback((): string => {
    if (!identity) throw new Error('No identity');
    return exportIdentityJSON(identity);
  }, [identity]);

  const importJSON = useCallback(async (json: string) => {
    const imported = await importIdentityJSON(json);
    setIdentity(imported);
    setStatus('ready');
    return imported;
  }, []);

  const destroy = useCallback(() => {
    deleteIdentity();
    setIdentity(null);
    setStatus('none');
  }, []);

  return { identity, status, create, setAlias, exportJSON, importJSON, destroy };
}
