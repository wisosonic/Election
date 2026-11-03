/** Shared classes so every label/input in the app looks the same -- imported
 * by LoginForm, BroadcastForm, and every admin page's forms rather than each
 * one hand-rolling its own input styling. */
export const labelClass = 'block text-sm font-medium text-slate-700';
export const inputClass =
  'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:border-brand-600 disabled:bg-slate-50 disabled:text-slate-500';
