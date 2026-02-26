import * as Dialog from '@radix-ui/react-dialog';

export default function Modal({ open, onClose, title, large, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal${large ? ' modal-lg' : ''}`} onClick={e => e.stopPropagation()}>
          {title && <Dialog.Title className="modal-title">{title}</Dialog.Title>}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
