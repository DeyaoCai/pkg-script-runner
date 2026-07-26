import { reactive } from 'vue';
import type { ControllerSlots } from './types.js';

export type { ControllerSlots };

/**
 * Vue Ctrl 基类：普通 Class，不对实例做 Proxy。
 * 泛型强制声明 data / props / state 形状；构造必须传入三槽位初值。
 */
export class Controller<
  TData extends object,
  TProps extends object,
  TState extends object,
> {
  readonly data: TData;
  readonly props: TProps;
  readonly state: TState;
  /** 子 Ctrl，普通引用，不 reactive */
  controllers: Record<string, Controller<object, object, object>> = {};

  constructor(slots: ControllerSlots<TData, TProps, TState>) {
    this.data = reactive(slots.data) as TData;
    this.props = reactive(slots.props) as TProps;
    this.state = reactive(slots.state) as TState;
  }

  /** 合并写入 data（同一代理，不换引用） */
  setData(patch: Partial<TData>): this {
    Object.assign(this.data, patch);
    return this;
  }

  setProps(patch: Partial<TProps>): this {
    Object.assign(this.props, patch);
    return this;
  }

  setState(patch: Partial<TState>): this {
    Object.assign(this.state, patch);
    return this;
  }
}
