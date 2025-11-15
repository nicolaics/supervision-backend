import { StatusCodes } from 'http-status-codes';
import { Nullable } from "./Nullable";

export interface ApiResponse<T> {
  success: boolean;
  status_code: StatusCodes;
  message: string;
  error_raw?: Nullable<Error>;
  data?: Nullable<T>;
}
