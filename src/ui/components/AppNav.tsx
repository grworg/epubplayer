/**
 * App Navigation
 *
 * Responsive navigation rendered as:
 * - Mobile: fixed bottom tab bar (below MiniPlayer)
 * - Desktop (md+): collapsed sidebar that expands on hover
 *
 * Only visible on Library (/app) and Browse (/app/browse) routes.
 */

import { NavLink } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { LibraryIcon, CompassIcon } from '@/ui/icons'

const navItems = [
  { to: '/app', label: <Trans>Library</Trans>, icon: LibraryIcon, end: true },
  { to: '/app/browse', label: <Trans>Browse</Trans>, icon: CompassIcon, end: false },
] as const

export function AppNav() {
  return (
    <>
      {/* Mobile bottom tabs */}
      <nav className="flex border-t border-border-muted bg-surface-1 pb-[env(safe-area-inset-bottom)] md:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
                isActive ? 'text-accent' : 'text-text-muted'
              }`
            }
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Desktop sidebar */}
      <nav
        className="group/sidebar hidden md:flex fixed left-0 top-0 z-30 h-full w-[60px] flex-col gap-1 border-r border-border-muted bg-surface-1 px-2 pt-4 transition-[width] duration-200 ease-in-out hover:w-[200px]"
      >
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text-primary'
              }`
            }
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            <span className="truncate text-sm font-medium opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
              {item.label}
            </span>
          </NavLink>
        ))}
      </nav>
    </>
  )
}
