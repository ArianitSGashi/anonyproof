import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, forwardRef } from "react";
import clsx from "clsx";
import { Loader2 } from "lucide-react";

/* ─── Button ──────────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-sm",
  secondary:
    "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100 shadow-sm",
  danger:
    "bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-800 shadow-sm",
  ghost:
    "text-slate-600 hover:bg-slate-100 active:bg-slate-200",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-2.5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "cursor-pointer",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

/* ─── Input ───────────────────────────────────────────────────────────────── */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ label, error, className, id, ...props }, ref) {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-slate-700"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            "block w-full rounded-lg border px-3 py-2 text-sm",
            "placeholder:text-slate-400",
            "focus:outline-2 focus:outline-offset-0 focus:outline-primary-500 focus:border-primary-500",
            error
              ? "border-accent-500 text-accent-900"
              : "border-slate-300 text-slate-900",
            className,
          )}
          {...props}
        />
        {error && <p className="text-sm text-accent-600">{error}</p>}
      </div>
    );
  },
);

/* ─── Textarea ────────────────────────────────────────────────────────────── */

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className, id, ...props }: TextareaProps) {
  const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={textareaId}
          className="block text-sm font-medium text-slate-700"
        >
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={clsx(
          "block w-full rounded-lg border px-3 py-2 text-sm resize-y min-h-[100px]",
          "placeholder:text-slate-400",
          "focus:outline-2 focus:outline-offset-0 focus:outline-primary-500 focus:border-primary-500",
          error
            ? "border-accent-500 text-accent-900"
            : "border-slate-300 text-slate-900",
          className,
        )}
        {...props}
      />
      {error && <p className="text-sm text-accent-600">{error}</p>}
    </div>
  );
}

/* ─── Card ────────────────────────────────────────────────────────────────── */

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-slate-200 bg-white shadow-sm",
        padding && "p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─── Badge ───────────────────────────────────────────────────────────────── */

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const badgeVariants: Record<BadgeVariant, string> = {
  default: "bg-slate-100 text-slate-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-primary-50 text-primary-700",
};

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        badgeVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ─── Spinner ─────────────────────────────────────────────────────────────── */

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={clsx("animate-spin text-primary-500", className ?? "h-6 w-6")}
    />
  );
}

/* ─── EmptyState ──────────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-4 text-slate-400">{icon}</div>}
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-slate-500 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* ─── StatCard ────────────────────────────────────────────────────────────── */

export function StatCard({
  label,
  value,
  icon,
  trend,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
          {trend && (
            <p className="mt-1 text-xs text-emerald-600">{trend}</p>
          )}
        </div>
        {icon && (
          <div className="rounded-lg bg-primary-50 p-2.5 text-primary-600">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ─── PageHeader ──────────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
