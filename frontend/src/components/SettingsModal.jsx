import React, { useState } from 'react';
import { X, Sliders, ShieldCheck } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose, settings, onSave }) {
  if (!isOpen) return null;

  const [formData, setFormData] = useState({
    max_power_w: settings.max_power_w ?? 2300,
    warn_power_pct: settings.warn_power_pct ?? 80,
    warn_temp_c: settings.warn_temp_c ?? 55,
    max_temp_c: settings.max_temp_c ?? 70,
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: Number(value),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSave(formData);
    setSaving(false);
    onClose();
  };

  const calculatedWarnWatts = ((formData.max_power_w * formData.warn_power_pct) / 100).toFixed(0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Sliders size={20} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Socket Safety Thresholds</h3>
              <p className="text-xs text-slate-400">Configure circuit breaker & thermal trip limits</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-sm font-medium text-slate-300">
                Max Allowed Power (W)
              </label>
              <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">
                Trip Threshold
              </span>
            </div>
            <input
              type="number"
              name="max_power_w"
              value={formData.max_power_w}
              onChange={handleChange}
              min="500"
              max="3680"
              step="50"
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              Socket immediately auto-trips FAULT when load exceeds this value (Typical 10A/16A rating: 2300W - 3680W).
            </p>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-sm font-medium text-slate-300">
                Power Warning Percentage (%)
              </label>
              <span className="text-xs font-mono text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40">
                Trigger: {calculatedWarnWatts}W
              </span>
            </div>
            <input
              type="range"
              name="warn_power_pct"
              value={formData.warn_power_pct}
              onChange={handleChange}
              min="50"
              max="95"
              step="5"
              className="w-full accent-cyan-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1 font-mono">
              <span>50%</span>
              <span className="text-amber-300 font-semibold">{formData.warn_power_pct}%</span>
              <span>95%</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Warning Temp (°C)
              </label>
              <input
                type="number"
                name="warn_temp_c"
                value={formData.warn_temp_c}
                onChange={handleChange}
                min="35"
                max="80"
                step="1"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-amber-500"
              />
              <span className="text-[11px] text-slate-500">Triggers Yellow warning banner</span>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Max Temp Limit (°C)
              </label>
              <input
                type="number"
                name="max_temp_c"
                value={formData.max_temp_c}
                onChange={handleChange}
                min="50"
                max="95"
                step="1"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-red-500"
              />
              <span className="text-[11px] text-slate-500">Auto emergency trip threshold</span>
            </div>
          </div>

          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center gap-3 text-xs text-slate-400">
            <ShieldCheck className="text-emerald-400 shrink-0" size={18} />
            <span>Settings are persisted in SQLite and synchronized to active telemetry evaluators in real-time.</span>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold transition flex items-center gap-2 shadow-lg shadow-cyan-500/20 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
