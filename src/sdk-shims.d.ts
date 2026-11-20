// SDK 的类型入口引用了 react-markdown 的类型；插件只消费 PluginContext 类型，
// 构建时这段声明不会进入产物。
declare module "react-markdown" {
  export type Components = Record<string, unknown>;
}
