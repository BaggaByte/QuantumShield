import React, { useState, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ResponsiveContainer
} from "recharts";
import { Play, Square, RefreshCw, Download, AlertTriangle, Loader } from "lucide-react";
import {
  generateX25519KeyPair, generateMLKEMKeyPair, mlkemEncapsulate, mlkemDecapsulate,
  x25519SharedSecret, deriveSessionKey, encryptMessage, decryptMessage, KEY_SIZES
} from "@/crypto/hybrid";
import type { CryptoMode, BenchmarkConfig, BenchmarkResult, TrialResult } from "@/types";

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function p95(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(arr: number[]) {
  return { median: median(arr), p95: p95(arr), min: Math.min(...arr), max: Math.max(...arr) };
}

async function runOneTrial(
  mode: CryptoMode, msgSizeBytes: number, simLatencyMs: number, simLossPercent: number, seed: number
): Promise<TrialResult> {
  // Simulate packet loss deterministically
  const pseudoRandom = ((seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  if (pseudoRandom < simLossPercent / 100) {
    return { trial: seed, keyGenMs: 0, handshakeMs: 0, encryptMs: 0, decryptMs: 0, handshakeBytesTotal: 0, success: false, error: "Simulated packet loss", simulated: true };
  }

  try {
    const t0 = performance.now();
    const aliceX = generateX25519KeyPair();
    const bobX = generateX25519KeyPair();
    let aliceMLKEM, bobMLKEM;
    if (mode === "hybrid") {
      aliceMLKEM = generateMLKEMKeyPair();
      bobMLKEM = generateMLKEMKeyPair();
    }
    const keyGenMs = performance.now() - t0 + simLatencyMs;

    const hStart = performance.now();
    const aliceSS = x25519SharedSecret(aliceX.privateKey, bobX.publicKey);
    const bobSS = x25519SharedSecret(bobX.privateKey, aliceX.publicKey);
    let aliceMLSS, bobMLSS;
    if (mode === "hybrid" && bobMLKEM) {
      const enc = mlkemEncapsulate(bobMLKEM.publicKey);
      aliceMLSS = enc.sharedSecret;
      bobMLSS = mlkemDecapsulate(enc.ciphertext, bobMLKEM.secretKey);
    }
    const aliceKey = await deriveSessionKey(aliceSS, `bench-${seed}`, mode, aliceMLSS);
    const bobKey = await deriveSessionKey(bobSS, `bench-${seed}`, mode, bobMLSS);
    const handshakeMs = performance.now() - hStart + simLatencyMs;

    // Generate message of target size
    const plaintext = "A".repeat(msgSizeBytes);
    const aad = new TextEncoder().encode(`bench-${seed}`);
    const encResult = await encryptMessage(plaintext, aliceKey.keyBytes, aad);
    const encryptMs = encResult.durationMs;
    const decResult = await decryptMessage(encResult.ciphertext, bobKey.keyBytes, aad);
    const decryptMs = decResult.durationMs;

    const handshakeBytesTotal = mode === "hybrid"
      ? KEY_SIZES.x25519.publicKey * 2 + KEY_SIZES.mlkem768.publicKey + KEY_SIZES.mlkem768.ciphertext
      : KEY_SIZES.x25519.publicKey * 2;

    return { trial: seed, keyGenMs, handshakeMs, encryptMs, decryptMs, handshakeBytesTotal, success: true, simulated: simLatencyMs > 0 || simLossPercent > 0 };
  } catch (e) {
    return { trial: seed, keyGenMs: 0, handshakeMs: 0, encryptMs: 0, decryptMs: 0, handshakeBytesTotal: 0, success: false, error: String(e), simulated: true };
  }
}

export default function BenchmarkPage() {
  const [config, setConfig] = useState<BenchmarkConfig>({
    mode: "hybrid", trials: 20, messageSizeBytes: 256,
    simulatedLatencyMs: 0, simulatedPacketLossPercent: 0,
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [comparisonData, setComparisonData] = useState<{ classical?: BenchmarkResult; hybrid?: BenchmarkResult }>({});
  const stopRef = useRef(false);

  const runBenchmark = async () => {
    setRunning(true);
    stopRef.current = false;
    setProgress(0);
    const trials: TrialResult[] = [];

    // Warmup
    for (let i = 0; i < 3; i++) await runOneTrial(config.mode, config.messageSizeBytes, 0, 0, i);

    for (let i = 0; i < config.trials; i++) {
      if (stopRef.current) break;
      const trial = await runOneTrial(config.mode, config.messageSizeBytes, config.simulatedLatencyMs, config.simulatedPacketLossPercent, i);
      trials.push(trial);
      setProgress(Math.round(((i + 1) / config.trials) * 100));
    }

    const succeeded = trials.filter(t => t.success);
    const res: BenchmarkResult = {
      config,
      trials,
      summary: {
        totalTrials: trials.length,
        successfulTrials: succeeded.length,
        failedTrials: trials.length - succeeded.length,
        keyGen: stats(succeeded.map(t => t.keyGenMs)),
        handshake: stats(succeeded.map(t => t.handshakeMs)),
        encrypt: stats(succeeded.map(t => t.encryptMs)),
        decrypt: stats(succeeded.map(t => t.decryptMs)),
        handshakeBytesTotal: succeeded[0]?.handshakeBytesTotal ?? 0,
        x25519PublicKeyBytes: KEY_SIZES.x25519.publicKey,
        mlkemPublicKeyBytes: config.mode === "hybrid" ? KEY_SIZES.mlkem768.publicKey : undefined,
        mlkemCiphertextBytes: config.mode === "hybrid" ? KEY_SIZES.mlkem768.ciphertext : undefined,
      },
      runAt: new Date().toISOString(),
      notes: `Browser-based benchmark. ${config.simulatedLatencyMs > 0 || config.simulatedPacketLossPercent > 0 ? "Network conditions are SIMULATED (not real network)." : "No network simulation."} CPU usage not measured. Results vary with browser scheduling.`,
    };

    setResult(res);
    setComparisonData(prev => ({ ...prev, [config.mode]: res }));
    setRunning(false);
  };

  const exportJSON = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quantumshield-bench-${config.mode}-${Date.now()}.json`;
    a.click();
  };

  const exportCSV = () => {
    if (!result) return;
    const headers = "trial,keyGenMs,handshakeMs,encryptMs,decryptMs,handshakeBytesTotal,success,simulated";
    const rows = result.trials.map(t =>
      `${t.trial},${t.keyGenMs.toFixed(3)},${t.handshakeMs.toFixed(3)},${t.encryptMs.toFixed(3)},${t.decryptMs.toFixed(3)},${t.handshakeBytesTotal},${t.success},${t.simulated}`
    );
    const blob = new Blob([[headers, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quantumshield-bench-${config.mode}-${Date.now()}.csv`;
    a.click();
  };

  const chartData = result?.trials.filter(t => t.success).map(t => ({
    name: `T${t.trial}`, handshake: +t.handshakeMs.toFixed(2), encrypt: +t.encryptMs.toFixed(3), decrypt: +t.decryptMs.toFixed(3),
  })) ?? [];

  const compChart = [
    { name: "Key Gen", classical: comparisonData.classical?.summary.keyGen.median, hybrid: comparisonData.hybrid?.summary.keyGen.median },
    { name: "Handshake", classical: comparisonData.classical?.summary.handshake.median, hybrid: comparisonData.hybrid?.summary.handshake.median },
    { name: "Encrypt", classical: comparisonData.classical?.summary.encrypt.median, hybrid: comparisonData.hybrid?.summary.encrypt.median },
    { name: "Decrypt", classical: comparisonData.classical?.summary.decrypt.median, hybrid: comparisonData.hybrid?.summary.decrypt.median },
  ];

  const StatBox = ({ label, val, unit = "ms" }: { label: string; val?: number; unit?: string }) => (
    <div className="bg-navy-900 rounded-lg p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-mono font-semibold text-cyan-400">{val?.toFixed(3) ?? "—"}<span className="text-xs text-slate-500 ml-1">{unit}</span></p>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Benchmark Laboratory</h1>
          <p className="text-slate-400 text-sm mt-1">Measure cryptographic performance across modes</p>
        </div>
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-400 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        All benchmarks run in your browser. Network simulations are deterministic (not real network measurements).
        CPU usage is not directly measurable. Results are affected by browser scheduling and system load.
      </div>

      {/* Config */}
      <div className="bg-navy-800 border border-white/10 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Configuration</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Mode</label>
            <select value={config.mode} onChange={e => setConfig(c => ({ ...c, mode: e.target.value as CryptoMode }))}
              className="w-full bg-navy-900 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500/50">
              <option value="classical">Classical (X25519)</option>
              <option value="hybrid">Hybrid (X25519 + ML-KEM-768)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Trials: {config.trials}</label>
            <input type="range" min={5} max={100} value={config.trials}
              onChange={e => setConfig(c => ({ ...c, trials: +e.target.value }))}
              className="w-full accent-cyan-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Message Size</label>
            <select value={config.messageSizeBytes} onChange={e => setConfig(c => ({ ...c, messageSizeBytes: +e.target.value }))}
              className="w-full bg-navy-900 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500/50">
              {[64, 256, 1024, 4096, 16384].map(s => <option key={s} value={s}>{s < 1024 ? s + "B" : s / 1024 + "KB"}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Simulated Latency: {config.simulatedLatencyMs}ms</label>
            <input type="range" min={0} max={500} step={10} value={config.simulatedLatencyMs}
              onChange={e => setConfig(c => ({ ...c, simulatedLatencyMs: +e.target.value }))}
              className="w-full accent-cyan-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Simulated Packet Loss: {config.simulatedPacketLossPercent}%</label>
            <input type="range" min={0} max={30} value={config.simulatedPacketLossPercent}
              onChange={e => setConfig(c => ({ ...c, simulatedPacketLossPercent: +e.target.value }))}
              className="w-full accent-cyan-500" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={runBenchmark} disabled={running}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 font-medium text-sm hover:bg-cyan-500/25 transition-colors disabled:opacity-50">
            {running ? <><Loader className="w-4 h-4 animate-spin" /> {progress}%</> : <><Play className="w-4 h-4" /> Run Benchmark</>}
          </button>
          {running && (
            <button onClick={() => { stopRef.current = true; }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10 transition-colors">
              <Square className="w-4 h-4" /> Stop
            </button>
          )}
          {result && !running && (
            <>
              <button onClick={exportJSON} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 text-slate-400 text-sm hover:border-white/20 transition-colors">
                <Download className="w-4 h-4" /> JSON
              </button>
              <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 text-slate-400 text-sm hover:border-white/20 transition-colors">
                <Download className="w-4 h-4" /> CSV
              </button>
              <button onClick={() => { setResult(null); setProgress(0); }} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 text-slate-400 text-sm hover:border-white/20 transition-colors">
                <RefreshCw className="w-4 h-4" /> Reset
              </button>
            </>
          )}
        </div>
        {running && (
          <div className="w-full bg-navy-900 rounded-full h-1.5">
            <div className="bg-cyan-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatBox label="Key Gen (median)" val={result.summary.keyGen.median} />
            <StatBox label="Handshake (median)" val={result.summary.handshake.median} />
            <StatBox label="Encrypt (median)" val={result.summary.encrypt.median} />
            <StatBox label="Decrypt (median)" val={result.summary.decrypt.median} />
            <StatBox label="Handshake (p95)" val={result.summary.handshake.p95} />
            <StatBox label="Total Handshake Bytes" val={result.summary.handshakeBytesTotal} unit="B" />
            <StatBox label="Successful Trials" val={result.summary.successfulTrials} unit="" />
            <StatBox label="Failed Trials" val={result.summary.failedTrials} unit="" />
          </div>

          {/* Trial-by-trial chart */}
          <div className="bg-navy-800 border border-white/10 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Handshake + Encrypt/Decrypt per Trial</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="handshake" stroke="#06b6d4" strokeWidth={2} dot={false} name="Handshake (ms)" />
                <Line type="monotone" dataKey="encrypt" stroke="#2dd4bf" strokeWidth={1.5} dot={false} name="Encrypt (ms)" />
                <Line type="monotone" dataKey="decrypt" stroke="#818cf8" strokeWidth={1.5} dot={false} name="Decrypt (ms)" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Notes */}
          <div className="bg-navy-800/50 border border-white/5 rounded-xl p-4 text-xs text-slate-400">
            <p><span className="text-slate-300 font-medium">Notes: </span>{result.notes}</p>
            <p className="mt-1">Run at: {result.runAt} | Trials: {result.summary.totalTrials} | Mode: {result.config.mode} | Message size: {result.config.messageSizeBytes}B</p>
          </div>
        </>
      )}

      {/* Comparison chart — shown when both modes have been run */}
      {comparisonData.classical && comparisonData.hybrid && (
        <div className="bg-navy-800 border border-white/10 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Classical vs. Hybrid Comparison (median ms)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={compChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="classical" fill="#94a3b8" name="Classical (ms)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="hybrid" fill="#06b6d4" name="Hybrid PQ (ms)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-500 mt-3">Run both classical and hybrid modes to populate this comparison. Results are median values from actual browser measurements.</p>
        </div>
      )}
    </div>
  );
}
