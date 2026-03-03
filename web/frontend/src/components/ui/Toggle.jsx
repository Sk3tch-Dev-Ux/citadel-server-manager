import * as Switch from '@radix-ui/react-switch';

export default function Toggle({ checked, onChange, onCheckedChange, label }) {
  const handler = onCheckedChange || onChange;
  return (
    <Switch.Root
      className={'toggle' + (checked ? ' on' : '')}
      checked={checked}
      onCheckedChange={handler}
    >
      <Switch.Thumb className="toggle-knob" />
    </Switch.Root>
  );
}

export function SettingsToggle({ label, checked, onChange }) {
  return (
    <div className="switch-row">
      <span className="switch-row-label">{label}</span>
      <div className="switch-status">
        <Toggle checked={checked} onChange={onChange} />
        <span className={'switch-status-text' + (checked ? ' active' : ' inactive')}>
          {checked ? 'Active' : 'Inactive'}
        </span>
      </div>
    </div>
  );
}
