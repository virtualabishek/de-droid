/**
 * Toast Container - Displays global toast notifications
 */
import { useToastStore, ToastType } from "../store/toastStore";

const toastStyles: Record<
  ToastType,
  { bg: string; border: string; icon: string; iconBg: string }
> = {
  success: {
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    icon: "text-green-400",
    iconBg: "bg-green-500/20",
  },
  error: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    icon: "text-red-400",
    iconBg: "bg-red-500/20",
  },
  warning: {
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    icon: "text-yellow-400",
    iconBg: "bg-yellow-500/20",
  },
  info: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    icon: "text-blue-400",
    iconBg: "bg-blue-500/20",
  },
};

const toastIcons: Record<ToastType, JSX.Element> = {
  success: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  ),
  error: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  ),
  warning: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  ),
  info: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-md">
      {toasts.map((toast) => {
        const style = toastStyles[toast.type];

        return (
          <div
            key={toast.id}
            className={`${style.bg} ${style.border} border rounded-lg p-4 shadow-lg backdrop-blur-sm animate-slide-in flex items-start gap-3`}
            role="alert"
          >
            {/* Icon */}
            <div
              className={`${style.iconBg} ${style.icon} p-2 rounded-full flex-shrink-0`}
            >
              {toastIcons[toast.type]}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-white">{toast.title}</p>
              {toast.message && (
                <p className="text-sm text-gray-300 mt-0.5">{toast.message}</p>
              )}
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action?.onClick();
                    removeToast(toast.id);
                  }}
                  className="text-sm text-primary-400 hover:text-primary-300 mt-2 font-medium"
                >
                  {toast.action.label}
                </button>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={() => removeToast(toast.id)}
              className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
