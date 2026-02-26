import { forwardRef } from 'react';

const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={`input${className ? ' ' + className : ''}`} {...props} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={`input${className ? ' ' + className : ''}`} {...props} />;
});

export default Input;
