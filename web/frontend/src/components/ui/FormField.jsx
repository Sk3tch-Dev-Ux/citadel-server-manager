export default function FormField({ label, hint, children }) {
  return (
    <div className="input-group">
      {label && <label className="input-label">{label}</label>}
      {children}
      {hint && <div className="settings-hint">{hint}</div>}
    </div>
  );
}
