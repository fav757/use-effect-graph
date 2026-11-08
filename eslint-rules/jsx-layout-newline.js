import stylistic from '@stylistic/eslint-plugin'

const jsxNewline = stylistic.rules['jsx-newline']

export default {
  ...jsxNewline,
  create(context) {
    const layoutContext = Object.create(context, {
      report: {
        value(descriptor) {
          // Prettier owns spacing in mixed text content, where whitespace
          // can affect the rendered output.
          const children = descriptor.node.parent?.children ?? []
          if (
            children.some(
              (child) => child.type === 'JSXText' && /\S/.test(child.value),
            )
          ) {
            return
          }

          context.report(descriptor)
        },
      },
    })

    return jsxNewline.create(layoutContext)
  },
}
