import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

export function DropdownMenu({ children }) {
  return <DropdownMenuPrimitive.Root>{children}</DropdownMenuPrimitive.Root>;
}

export function DropdownMenuTrigger({ children, asChild = true }) {
  return <DropdownMenuPrimitive.Trigger asChild={asChild}>{children}</DropdownMenuPrimitive.Trigger>;
}

export function DropdownMenuContent({ children, align = 'end', sideOffset = 5 }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content className="dropdown-content" align={align} sideOffset={sideOffset}>
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ children, onSelect, danger }) {
  return (
    <DropdownMenuPrimitive.Item
      className={`dropdown-item${danger ? ' danger' : ''}`}
      onSelect={onSelect}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="dropdown-separator" />;
}
