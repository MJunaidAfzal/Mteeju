const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Overview({ name }: { name: string }) {
  const firstName = name.split(' ')[0]

  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{today}</p>
        <h1>
          {greeting()}, <em>{firstName}</em>
        </h1>
        <p className="page-head__sub">Welcome to your Teeju portal.</p>
      </div>
    </div>
  )
}
