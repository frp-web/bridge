import ora from 'ora'

/** Execute function with loading spinner */
export async function loadingFunction<T>(message: string, fn: () => Promise<T>): Promise<T> {
  const spinner = ora(message).start()

  return fn().finally(() => {
    spinner.stop()
  })
}
