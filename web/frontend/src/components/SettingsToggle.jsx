export default function SettingsToggle({ label, checked, onChange }) {
  return (
    <div className="switch-row">
      <span className="switch-row-label">{label}</span>
      <div className="switch-status">
        <div className={'toggle' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
          <div className="toggle-knob" />
        </div>
        <span className={'switch-status-text' + (checked ? ' active' : ' inactive')}>
          {checked ? 'Active' : 'Inactive'}
        </span>
      </div>
    </div>
  );
}
