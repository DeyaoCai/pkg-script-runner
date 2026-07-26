/**
 * Vue Ctrl 三槽位初值形状（运行时基类在 @pkg-runner/controller）
 */
export type ControllerSlots<
  TData extends object,
  TProps extends object,
  TState extends object,
> = {
  data: TData;
  props: TProps;
  state: TState;
};
