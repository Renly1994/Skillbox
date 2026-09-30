import { Suspense, lazy } from "react"
import { HashRouter, Navigate, Routes, Route } from "react-router-dom"
import { UpdateBanner } from "./components/update-banner"
import { Home } from "./routes/home"
import { SupportAuthorDialog } from "./components/support-author"

const Discover = lazy(() =>
  import("./routes/discover").then((module) => ({ default: module.Discover })),
)
const Settings = lazy(() =>
  import("./routes/settings").then((module) => ({ default: module.Settings })),
)
const Mcp = lazy(() =>
  import("./routes/mcp").then((module) => ({ default: module.Mcp })),
)
const Dashboard = lazy(() =>
  import("./routes/dashboard").then((module) => ({ default: module.Dashboard })),
)
function RouteFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-[12px] text-muted">
      Loading view...
    </div>
  )
}

export function App() {
  return (
    <HashRouter>
      <div className="flex h-screen overflow-hidden bg-background text-foreground font-sans">
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <UpdateBanner />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/library" element={<Home />} />
              <Route path="/discover" element={<Discover />} />
              <Route path="/mcp" element={<Mcp />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <Settings />
          </Suspense>
          <SupportAuthorDialog />
        </main>
      </div>
    </HashRouter>
  )
}
