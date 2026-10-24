/**
 * QuantumShield - Identity Card (Sidebar Widget)
 *
 * Shows the user's identity fingerprint, alias, and quick actions:
 * - Copy fingerprint
 * - Edit alias
 * - Export identity (JSON backup)
 * - Delete identity (with confirmation)
 */

import React, { useState, useRef } from 'react';
import {
  Fingerprint, Copy, Check, Pencil, Download, Trash2, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { QSIdentity } from '@/services/IdentityService';

interface IdentityCardProps {
  identity: QSIdentity;
  onAliasChange: (alias: string) => void;
  onExport: () => string;
  onDelete: () => void;
}

export default function IdentityCard({
  identity, onAliasChange, onExport, onDelete,
}: IdentityCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState(identity.alias);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const aliasRef = useRef<HTMLInputElement>(null);

  const copyFingerprint = async () => {
    await navigator.clipboard.writeText(identity.fingerprint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveAlias = () => {
    onAliasChange(aliasInput.trim());
    setEditingAlias(false);
  };

  const handleExport = () => {
    const json = onExport();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quantumshield-identity-${identity.fingerprint.replace(/·/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Parse fingerprint parts for coloured display
  const [, part1, part2] = identity.fingerprint.split('·');

  return (
    <div className="mx-3 mb-3">
      <div className="bg-navy-950/60 border border-white/8 rounded-2xl overflow-hidden">
        {/* Collapsed header — always visible */}
        <button
          onClick={() => setExpanded(p => !p)}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 hover:bg-white/3 transition-colors group"
        >
          {/* Avatar — fingerprint-derived gradient dot */}
          <div className="relative flex-shrink-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{
                background: `linear-gradient(135deg, hsl(${parseInt(part1 ?? '00', 16) % 360}, 70%, 50%), hsl(${parseInt(part2 ?? '00', 16) % 360}, 70%, 40%))`,
              }}
            >
              {(identity.alias || identity.fingerprint).slice(0, 1).toUpperCase()}
            </div>
            {/* Online dot */}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 border-2 border-navy-950 rounded-full" />
          </div>

          <div className="flex-1 min-w-0 text-left">
            <p className="text-xs font-semibold text-white truncate">
              {identity.alias || 'Anonymous'}
            </p>
            <p className="text-[10px] font-mono text-cyan-400/80 tracking-wider">
              {identity.fingerprint}
            </p>
          </div>

          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-400" />
          }
        </button>

        {/* Expanded panel */}
        {expanded && (
          <div className="border-t border-white/5 px-3.5 py-3 space-y-3 animate-fade-in">

            {/* Fingerprint row */}
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                Cryptographic Identity
              </p>
              <div className="flex items-center gap-2 bg-navy-900/60 rounded-lg px-3 py-2">
                <Fingerprint className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                <span className="flex-1 text-xs font-mono text-white tracking-wider">
                  <span className="text-slate-400">QS·</span>
                  <span className="text-cyan-300">{part1}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-violet-300">{part2}</span>
                </span>
                <button
                  onClick={copyFingerprint}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  title="Copy fingerprint"
                >
                  {copied
                    ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                    : <Copy className="w-3.5 h-3.5 text-slate-400" />
                  }
                </button>
              </div>
            </div>

            {/* Alias edit */}
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-slate-500">Display Name</p>
              {editingAlias ? (
                <div className="flex gap-2">
                  <input
                    ref={aliasRef}
                    value={aliasInput}
                    onChange={e => setAliasInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveAlias(); if (e.key === 'Escape') setEditingAlias(false); }}
                    autoFocus
                    maxLength={32}
                    className="flex-1 px-2.5 py-1.5 bg-navy-950/80 border border-cyan-500/40 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                  />
                  <button onClick={saveAlias} className="p-1.5 bg-cyan-500/20 rounded-lg hover:bg-cyan-500/30 transition-colors">
                    <Check className="w-3.5 h-3.5 text-cyan-400" />
                  </button>
                  <button onClick={() => setEditingAlias(false)} className="p-1.5 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                    <X className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setAliasInput(identity.alias); setEditingAlias(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-navy-900/60 rounded-lg hover:bg-navy-900 transition-colors group"
                >
                  <span className="flex-1 text-left text-xs text-white">
                    {identity.alias || <span className="text-slate-500 italic">Not set</span>}
                  </span>
                  <Pencil className="w-3 h-3 text-slate-500 group-hover:text-slate-300" />
                </button>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleExport}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors font-medium"
                title="Download identity backup (JSON)"
              >
                <Download className="w-3 h-3" />
                Backup
              </button>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-red-400/70 hover:text-red-400 bg-red-500/5 hover:bg-red-500/10 rounded-lg transition-colors font-medium"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              ) : (
                <button
                  onClick={onDelete}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors font-bold animate-pulse"
                >
                  <Trash2 className="w-3 h-3" />
                  Confirm
                </button>
              )}
            </div>

            {/* Creation date */}
            <p className="text-[10px] text-slate-600 text-center">
              Created {new Date(identity.createdAt).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
