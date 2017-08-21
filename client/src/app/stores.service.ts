import { Injectable } from '@angular/core';
import {Http, RequestOptions, Headers, URLSearchParams } from '@angular/http';
import {Chaine} from './chaine';
import 'rxjs/add/operator/toPromise' ;


@Injectable()
export class StoresService1 {
  private chainesUrl= 'http://127.0.0.1:8000/chains/';
  private levelsUrl = 'http://127.0.0.1:8000/level/';
   headers: Headers;
    options: RequestOptions;

  constructor(private http: Http) {
    this.headers = new Headers({ 'Accept': 'application/json'});
    this.options = new RequestOptions({ headers: this.headers});
  }
//i'm so deeprsseed that i' don't even know why i'm typing this right now
  getChaines(): Promise<Chaine[]>{
      return this.http.get(this.chainesUrl)
        .toPromise()
        .then(response => {return response.json() as Chaine[];
        })
        .catch(this.handleError);
  }

  private handleError(error: any): Promise<any> {
  console.error('An error occurred', error); // for demo purposes only
  return Promise.reject(error.message || error);
}

  postLevel(lvl): Promise<any> {
    return  this.http.post(this.levelsUrl, lvl , this.options ).toPromise()
      .then( value => {value.json() ;  console.log(value); })
      .catch(reason => {console.log(reason); });
  }

}
