/**
 * Layout Component - With local authentication and theme support
 */
import { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useThemeStore } from "../store/themeStore";
import { ToastContainer } from "./ToastContainer";

const SIDEBAR_COLLAPSE_KEY = "de-droid.sidebar.collapsed";

// Theme Toggle Component
function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      className={`theme-toggle ${isDark ? "theme-toggle-dark" : "theme-toggle-light"}`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <div
        className={`theme-toggle-knob ${isDark ? "theme-toggle-knob-dark" : "theme-toggle-knob-light"}`}
      >
        {isDark ? (
          <svg
            className="w-4 h-4 text-yellow-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        ) : (
          <svg
            className="w-4 h-4 text-yellow-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
    </button>
  );
}

export function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (saved === "true") {
      setIsSidebarCollapsed(true);
    }
  }, []);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(next));
      return next;
    });
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="h-screen overflow-hidden bg-gray-900 text-white flex">
      {/* Toast Notifications */}
      <ToastContainer />

      {/* Sidebar */}
      <aside
        className={`h-full bg-gray-800 border-r border-gray-700 flex flex-col transition-all duration-200 ${
          isSidebarCollapsed ? "w-20" : "w-64"
        }`}
      >
        <div className={`border-b border-gray-700 ${isSidebarCollapsed ? "p-3" : "p-6"}`}>
          <div
            className={`flex items-center ${isSidebarCollapsed ? "flex-col gap-2" : "justify-between"}`}
          >
            <div className={isSidebarCollapsed ? "hidden" : "block"}>
              <h1 className="text-2xl font-bold text-primary-400">De-Droid</h1>
              <p className="text-sm text-gray-400 mt-1">Android Debloater</p>
            </div>
            <ThemeToggle />
            <button
              onClick={toggleSidebar}
              className="p-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {isSidebarCollapsed ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 5l7 7-7 7M4 5l7 7-7 7"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 19l-7-7 7-7m9 14l-7-7 7-7"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        <nav className={`flex-1 ${isSidebarCollapsed ? "p-2" : "p-4"}`}>
          <ul className="space-y-2">
            <li>
              <NavLink
                to="/dashboard"
                className={({ isActive }) =>
                  `flex items-center py-3 rounded-lg transition-colors ${
                    isSidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
                  } ${
                    isActive
                      ? "bg-primary-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`
                }
                title="Dashboard"
              >
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
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                {!isSidebarCollapsed && <span>Dashboard</span>}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/packages"
                className={({ isActive }) =>
                  `flex items-center py-3 rounded-lg transition-colors ${
                    isSidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
                  } ${
                    isActive
                      ? "bg-primary-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`
                }
                title="Packages"
              >
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
                    d="M20 13V7a2 2 0 00-2-2h-4V3H10v2H6a2 2 0 00-2 2v6m16 0v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6m16 0h-4a2 2 0 01-2-2V9a2 2 0 012-2h4m-16 6h4a2 2 0 002-2V9a2 2 0 00-2-2H4"
                  />
                </svg>
                {!isSidebarCollapsed && <span>Packages</span>}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/ai-insights"
                className={({ isActive }) =>
                  `flex items-center py-3 rounded-lg transition-colors ${
                    isSidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
                  } ${
                    isActive
                      ? "bg-indigo-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`
                }
                title="AI / ML Insights"
              >
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
                    d="M9.75 3v1.5m4.5-1.5v1.5M4.5 9h15M6.75 21h10.5A2.25 2.25 0 0019.5 18.75V8.25A2.25 2.25 0 0017.25 6H6.75A2.25 2.25 0 004.5 8.25v10.5A2.25 2.25 0 006.75 21zM9 14.25l1.5 1.5 4.5-4.5"
                  />
                </svg>
                {!isSidebarCollapsed && <span>AI / ML Insights</span>}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/device-health"
                className={({ isActive }) =>
                  `flex items-center py-3 rounded-lg transition-colors ${
                    isSidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
                  } ${
                    isActive
                      ? "bg-cyan-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`
                }
                title="Device Health"
              >
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
                    d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2z"
                  />
                </svg>
                {!isSidebarCollapsed && <span>Device Health</span>}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/history"
                className={({ isActive }) =>
                  `flex items-center py-3 rounded-lg transition-colors ${
                    isSidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
                  } ${
                    isActive
                      ? "bg-primary-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`
                }
                title="History"
              >
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
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {!isSidebarCollapsed && <span>History</span>}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/permissions"
                className={({ isActive }) =>
                  `flex items-center py-3 rounded-lg transition-colors ${
                    isSidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
                  } ${
                    isActive
                      ? "bg-purple-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`
                }
                title="Permissions"
              >
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
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                {!isSidebarCollapsed && <span>Permissions</span>}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/alternatives"
                className={({ isActive }) =>
                  `flex items-center py-3 rounded-lg transition-colors ${
                    isSidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
                  } ${
                    isActive
                      ? "bg-green-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`
                }
                title="Open Source Apps"
              >
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                {!isSidebarCollapsed && <span>Open Source Apps</span>}
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  `flex items-center py-3 rounded-lg transition-colors ${
                    isSidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
                  } ${
                    isActive
                      ? "bg-primary-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`
                }
                title="Settings"
              >
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
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                {!isSidebarCollapsed && <span>Settings</span>}
              </NavLink>
            </li>
          </ul>
        </nav>

        <div className={`border-t border-gray-700 ${isSidebarCollapsed ? "p-2" : "p-4"}`}>
          <div
            className={`flex ${
              isSidebarCollapsed
                ? "flex-col items-center gap-2 px-2 py-2"
                : "items-center gap-3 px-4 py-2"
            }`}
          >
            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-sm font-medium">
              {user?.name?.[0]?.toUpperCase() ||
                user?.email?.[0]?.toUpperCase() ||
                "U"}
            </div>
            {!isSidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user?.name || user?.email?.split("@")[0] || "User"}
                </p>
                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="Logout"
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
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 h-full overflow-y-auto overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
