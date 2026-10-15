# Possible Hermes V1 async/await issue

I ran into what looks like the same problem while debugging on Expo SDK 56 / RN 0.85.

At first it looked like `fetch` was broken:

```ts
const response = await fetch(url, options);
console.log(response); // undefined
```

But the same request worked if I used promise chaining:

```ts
fetch(url, options).then((response) => {
  console.log(response); // valid Response
});
```

So I don't think the network request or `fetch` itself is the real problem. It looks more like the Promise resolves correctly, but the native `await` path resumes with `undefined`.

One thing I noticed is that Expo SDK 56's Babel preset selects the Hermes V1 profile when the caller engine is Hermes. That profile preserves native `async`/`await`, while the older Hermes V0/default profile includes `@babel/plugin-transform-async-to-generator`.

As a quick test, I added this to the app:

```js
module.exports = function (api) {
  api.cache(true);

  return {
    presets: ["babel-preset-expo"],
    plugins: ["@babel/plugin-transform-async-to-generator"],
  };
};
```

After forcing async functions through `async-to-generator`, the broken `await fetch(...)` path started working again.

So my current guess is:

- `fetch` resolves with a valid `Response`
- `.then(...)` sees that value correctly
- native `await` on this Expo SDK 56 / RN 0.85 / Hermes V1 stack sometimes gets `undefined`
- forcing `async-to-generator` avoids that Hermes native await path

That seems to line up with this issue pretty closely.
