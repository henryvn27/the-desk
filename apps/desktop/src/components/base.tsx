import {
  Button as AriaButton,
  Input as AriaInput,
  TextArea as AriaTextArea,
  type ButtonProps as AriaButtonProps,
  type InputProps as AriaInputProps,
  type TextAreaProps as AriaTextAreaProps,
} from "react-aria-components";
import { forwardRef } from "react";
import type { ComponentProps, ComponentType, ReactNode, SVGProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "compact" | "default" | "icon";

export type DeskIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number; color?: string }>;

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  variant = "secondary",
  size = "default",
  icon,
  className,
  children,
  ...props
}: Omit<AriaButtonProps, "className" | "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: DeskIcon;
  className?: string;
  children?: ReactNode;
}) {
  const Icon = icon;
  return (
    <AriaButton
      {...props}
      className={cx("ds-button", `ds-button-${variant}`, `ds-button-${size}`, className)}
    >
      {Icon && <Icon size={size === "icon" ? 17 : 16} aria-hidden="true" />}
      {children}
    </AriaButton>
  );
}

export function IconButton({
  label,
  icon,
  variant = "quiet",
  size = "icon",
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "icon"> & {
  label: string;
  icon: DeskIcon;
}) {
  return (
    <Button
      {...props}
      aria-label={label}
      variant={variant}
      size={size}
      icon={icon}
      className={className}
    />
  );
}

export function Input({ className, ...props }: Omit<AriaInputProps, "className"> & { className?: string }) {
  return <AriaInput {...props} className={cx("ds-input", className)} />;
}

export const Textarea = forwardRef<HTMLTextAreaElement, Omit<AriaTextAreaProps, "className"> & { className?: string }>(
  ({ className, ...props }, ref) => <AriaTextArea {...props} ref={ref} className={cx("ds-textarea", className)} />,
);
Textarea.displayName = "Textarea";

export function StatusDot({ tone = "neutral" }: { tone?: "neutral" | "positive" | "warning" | "danger" }) {
  return <span className={cx("ds-status-dot", `ds-status-dot-${tone}`)} aria-hidden="true" />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "positive" | "warning" | "danger" | "accent" }) {
  return <span className={cx("ds-badge", `ds-badge-${tone}`)}>{children}</span>;
}

export function SectionHeader({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ds-section-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {detail && <p className="ds-section-detail">{detail}</p>}
      </div>
      {action && <div className="ds-section-action">{action}</div>}
    </div>
  );
}
