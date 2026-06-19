import ConfiguredHome from '../components/ConfiguredHome'

// HomeModule renders the global landing screen entirely from a configured Home
// Page, resolved per the current user's role or the org default. There is no
// built-in/hardcoded dashboard: the home screen is data-driven and editable
// through the Home Page builder in Setup, consistent with the rest of the
// platform. The shared ConfiguredHome component is the single render path used
// here and by every module's Home tab.
export default function HomeModule({ onOpenSetup, onOpenRecord }) {
  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <ConfiguredHome crumb="Home" onOpenSetup={onOpenSetup} onOpenRecord={onOpenRecord} />
    </div>
  )
}
