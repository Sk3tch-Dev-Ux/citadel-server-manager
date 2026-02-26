import * as TabsPrimitive from '@radix-ui/react-tabs';

export function Tabs({ value, onValueChange, children }) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      {children}
    </TabsPrimitive.Root>
  );
}

export function TabsList({ children }) {
  return (
    <TabsPrimitive.List className="tabs">
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }) {
  return (
    <TabsPrimitive.Trigger value={value} className="tab" data-state-active="">
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ value, children }) {
  return (
    <TabsPrimitive.Content value={value}>
      {children}
    </TabsPrimitive.Content>
  );
}
