/**
 * Device Icon Component - Shows device preview based on brand/model
 */
import { useMemo } from "react";

interface DeviceIconProps {
  brand: string;
  model: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

// Brand colors for device icons
const brandColors: Record<
  string,
  { bg: string; text: string; accent: string }
> = {
  samsung: {
    bg: "from-blue-600 to-blue-800",
    text: "text-blue-100",
    accent: "bg-blue-400",
  },
  google: {
    bg: "from-green-500 to-blue-500",
    text: "text-white",
    accent: "bg-white",
  },
  pixel: {
    bg: "from-orange-400 to-pink-500",
    text: "text-white",
    accent: "bg-white",
  },
  xiaomi: {
    bg: "from-orange-500 to-red-600",
    text: "text-white",
    accent: "bg-orange-300",
  },
  redmi: {
    bg: "from-red-500 to-red-700",
    text: "text-white",
    accent: "bg-red-300",
  },
  poco: {
    bg: "from-yellow-400 to-yellow-600",
    text: "text-gray-900",
    accent: "bg-yellow-200",
  },
  oneplus: {
    bg: "from-red-600 to-red-800",
    text: "text-white",
    accent: "bg-red-300",
  },
  oppo: {
    bg: "from-green-400 to-green-600",
    text: "text-white",
    accent: "bg-green-200",
  },
  vivo: {
    bg: "from-blue-400 to-primary-500",
    text: "text-white",
    accent: "bg-blue-200",
  },
  realme: {
    bg: "from-yellow-400 to-yellow-600",
    text: "text-gray-900",
    accent: "bg-yellow-200",
  },
  huawei: {
    bg: "from-red-500 to-red-700",
    text: "text-white",
    accent: "bg-red-300",
  },
  honor: {
    bg: "from-blue-500 to-blue-700",
    text: "text-white",
    accent: "bg-blue-300",
  },
  motorola: {
    bg: "from-blue-600 to-primary-700",
    text: "text-white",
    accent: "bg-blue-300",
  },
  nokia: {
    bg: "from-blue-700 to-blue-900",
    text: "text-white",
    accent: "bg-blue-400",
  },
  sony: {
    bg: "from-gray-700 to-gray-900",
    text: "text-white",
    accent: "bg-gray-400",
  },
  lg: {
    bg: "from-red-600 to-gray-700",
    text: "text-white",
    accent: "bg-red-300",
  },
  asus: {
    bg: "from-gray-800 to-gray-900",
    text: "text-white",
    accent: "bg-red-500",
  },
  lenovo: {
    bg: "from-red-500 to-gray-800",
    text: "text-white",
    accent: "bg-red-300",
  },
  zte: {
    bg: "from-blue-500 to-blue-700",
    text: "text-white",
    accent: "bg-blue-300",
  },
  tcl: {
    bg: "from-orange-500 to-orange-700",
    text: "text-white",
    accent: "bg-orange-300",
  },
  nothing: {
    bg: "from-gray-800 to-black",
    text: "text-white",
    accent: "bg-red-500",
  },
  default: {
    bg: "from-gray-600 to-gray-800",
    text: "text-white",
    accent: "bg-gray-400",
  },
};

// Brand logos/letters
const brandIcons: Record<string, string> = {
  samsung: "S",
  google: "G",
  pixel: "P",
  xiaomi: "Mi",
  redmi: "R",
  poco: "P",
  oneplus: "1+",
  oppo: "O",
  vivo: "V",
  realme: "r",
  huawei: "H",
  honor: "H",
  motorola: "M",
  nokia: "N",
  sony: "S",
  lg: "LG",
  asus: "A",
  lenovo: "L",
  zte: "Z",
  tcl: "T",
  nothing: "()",
};

const sizeClasses = {
  sm: {
    wrapper: "w-10 h-16",
    screen: "w-8 h-12",
    text: "text-xs",
    notch: "w-4 h-1",
  },
  md: {
    wrapper: "w-14 h-24",
    screen: "w-12 h-20",
    text: "text-sm",
    notch: "w-6 h-1.5",
  },
  lg: {
    wrapper: "w-20 h-32",
    screen: "w-16 h-28",
    text: "text-base",
    notch: "w-8 h-2",
  },
};

export function DeviceIcon({
  brand,
  model,
  size = "md",
  className = "",
}: DeviceIconProps) {
  const normalizedBrand = useMemo(() => {
    const b = brand.toLowerCase();
    // Check for brand in model name too
    const m = model.toLowerCase();

    for (const key of Object.keys(brandColors)) {
      if (b.includes(key) || m.includes(key)) {
        return key;
      }
    }
    return "default";
  }, [brand, model]);

  const colors = brandColors[normalizedBrand];
  const icon = brandIcons[normalizedBrand] || brand[0]?.toUpperCase() || "?";
  const sizeClass = sizeClasses[size];

  return (
    <div className={`relative ${className}`} title={`${brand} ${model}`}>
      {/* Phone body */}
      <div
        className={`${sizeClass.wrapper} rounded-xl bg-gradient-to-b ${colors.bg} p-1 shadow-lg relative overflow-hidden`}
      >
        {/* Screen */}
        <div
          className={`${sizeClass.screen} bg-gray-900 rounded-lg mx-auto flex items-center justify-center relative`}
        >
          {/* Notch/Camera */}
          <div
            className={`absolute top-1 ${sizeClass.notch} ${colors.accent} rounded-full opacity-60`}
          ></div>

          {/* Brand icon */}
          <span
            className={`${colors.text} font-bold ${sizeClass.text} opacity-80`}
          >
            {icon}
          </span>

          {/* Screen glow effect */}
          <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/5 rounded-lg"></div>
        </div>

        {/* Side button indicator */}
        <div
          className={`absolute right-0 top-1/3 w-0.5 h-4 ${colors.accent} opacity-40 rounded-l`}
        ></div>

        {/* Phone reflection */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-xl pointer-events-none"></div>
      </div>

      {/* Connection indicator */}
      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-800 animate-pulse"></div>
    </div>
  );
}

// Compact device badge for lists
export function DeviceBadge({
  brand,
  model,
}: {
  brand: string;
  model: string;
}) {
  const normalizedBrand = useMemo(() => {
    const b = brand.toLowerCase();
    for (const key of Object.keys(brandColors)) {
      if (b.includes(key)) return key;
    }
    return "default";
  }, [brand]);

  const colors = brandColors[normalizedBrand];

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${colors.bg} ${colors.text} text-xs font-medium`}
    >
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
      <span className="truncate max-w-[100px]">{model}</span>
    </div>
  );
}
