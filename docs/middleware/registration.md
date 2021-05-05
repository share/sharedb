---
title: Registration
nav_order: 1
layout: default
parent: Middleware
---

# Registering middleware

Middleware is registered on the server with [`backend.use()`]({{ site.baseurl }}{% link api/backend.md %}#use):

```js
backend.use(action, function(context, next) {
  // Do something with the context

  // Call next when ready. Can optionally pass an error to stop
  // the current action, and return the error to the client
  next(error)
})
```

Valid `action`s and their corresponding `context` shape can be found [here]({{ site.baseurl }}{% link middleware/actions.md %}).
