import { forwardRef } from 'react';

const Button = forwardRef(function Button({ variant = 'primary', size, icon, children, className, ...props }, ref) {
  const classes = [
    'btn',
    variant === 'icon' ? 'btn-icon' : `btn-${variant}`,
    size === 'sm' && 'btn-sm',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button ref={ref} className={classes} {...props}>
      {children}
    </button>
  );
});

export default Button;
