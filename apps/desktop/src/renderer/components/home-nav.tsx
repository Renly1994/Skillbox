import { NavLink } from "react-router-dom"

// House icon for the sidebar "首页" entry (from the dashboard design).
export function HomeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  )
}

// Sidebar "首页" entry — first nav item on every page, links to the dashboard.
// Uses the same skillbox-library-button treatment as "All Skills" so the
// selected state is identical across pages.
export function HomeNavLink() {
  return (
    <NavLink
      to="/"
      end
      className={({ isActive }) => `skillbox-library-button ${isActive ? "is-active" : ""}`}
    >
      <span className="flex items-center gap-2">
        <HomeIcon size={14} /> 首页
      </span>
    </NavLink>
  )
}
