import { useState } from 'react';
import { ChevronDown } from './Icon';

export default function Accordion({ title, icon, defaultOpen, danger, children }) {
  const [open, setOpen] = useState(defaultOpen || false);
  return (
    <div className={'accordion' + (danger ? ' danger' : '')}>
      <div className="accordion-header" onClick={() => setOpen(!open)}>
        <h3>{icon && <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}{title}</h3>
        <span className={'accordion-chevron' + (open ? ' open' : '')}><ChevronDown size={16} /></span>
      </div>
      {open && <div className="accordion-body">{children}</div>}
    </div>
  );
}
