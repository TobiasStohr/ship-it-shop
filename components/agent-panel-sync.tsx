"use client"

import { useEffect, useLayoutEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { useSidebar } from "@/components/ui/sidebar"

// The agent panel is open when the `chat` param exists.
const CHAT_PARAM = "chat"
const CHAT_VALUE = "open"
// Class on <html> that suppresses the panel's slide animation (see globals.css).
const BOOT_CLASS = "agent-panel-booting"

// useLayoutEffect on the client, no-op on the server (avoids the SSR warning).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect

function paramPresent() {
  return new URLSearchParams(window.location.search).has(CHAT_PARAM)
}

/**
 * Bridges the agent panel's open state to a `?chat=open` URL param so it
 * survives refresh and rides along across route navigation.
 *
 * Renders null and is mounted inside SidebarProvider (so it can read the
 * sidebar state) but never wraps page content. It reads window.location and
 * usePathname() instead of useSearchParams(), which would turn off static
 * rendering for the whole route group.
 */
export function AgentPanelSync() {
  const { open, setOpen, openMobile, setOpenMobile, isMobile } = useSidebar()
  const pathname = usePathname()

  // setOpen / setOpenMobile identities change whenever the sidebar state
  // changes (their useCallback dep is `open`), so keep them in a ref to leave
  // the mount/popstate effect's deps empty. (useLatest pattern.)
  const latest = useRef({ setOpen, setOpenMobile })
  latest.current = { setOpen, setOpenMobile }

  const effectiveOpen = isMobile ? openMobile : open

  // URL -> state on mount. Runs before the first client paint and suppresses
  // the slide animation, so a refresh with ?chat=open shows the panel already
  // open with no animation. (The server always renders it closed.)
  useIsomorphicLayoutEffect(() => {
    if (!paramPresent()) return
    const root = document.documentElement
    root.classList.add(BOOT_CLASS)
    // isMobile is false until after mount, so prime both states.
    latest.current.setOpen(true)
    latest.current.setOpenMobile(true)
    // Re-enable transitions once the open state has painted.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => root.classList.remove(BOOT_CLASS)),
    )
    return () => {
      cancelAnimationFrame(raf)
      root.classList.remove(BOOT_CLASS)
    }
  }, [])

  // Keep the panel in sync with the URL on back/forward navigation.
  useEffect(() => {
    const sync = () => {
      const present = paramPresent()
      latest.current.setOpen(present)
      latest.current.setOpenMobile(present)
    }
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  // Write the panel state to the URL with history.replaceState. The router
  // would cause an RSC request and a scroll jump. Every close path goes
  // through the sidebar state, so this effect covers all of them.
  const firstRun = useRef(true)
  useEffect(() => {
    // Skip the first run so we don't strip the param before the mount effect
    // above has applied it to the state.
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const params = new URLSearchParams(window.location.search)
    const hasParam = params.has(CHAT_PARAM)
    if (effectiveOpen === hasParam) return
    if (effectiveOpen) params.set(CHAT_PARAM, CHAT_VALUE)
    else params.delete(CHAT_PARAM)
    const qs = params.toString()
    window.history.replaceState(
      window.history.state,
      "",
      qs ? `${pathname}?${qs}` : pathname,
    )
  }, [effectiveOpen, pathname])

  return null
}
