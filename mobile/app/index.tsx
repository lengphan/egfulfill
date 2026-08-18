import { useEffect, useState } from "react"
import { View, Text, ActivityIndicator } from "react-native"
import { router } from "expo-router"
import { getToken } from "@/lib/api"
import { C } from "@/lib/theme"

/** Decide once, on launch: signed in → Today, otherwise → sign in. */
export default function Index() {
  const [msg, setMsg] = useState("")
  useEffect(() => {
    let alive = true
    getToken()
      .then((t) => { if (alive) router.replace(t ? "/today" : "/login") })
      .catch(() => { if (alive) setMsg("Couldn't read the saved session.") })
    return () => { alive = false }
  }, [])
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}>
      {msg ? <Text style={{ color: C.alert }}>{msg}</Text> : <ActivityIndicator color={C.primary} />}
    </View>
  )
}
